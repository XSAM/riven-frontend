import providers from "$lib/providers";
import type { components } from "$lib/providers/riven";
import { createScopedLogger } from "$lib/logger";

const logger = createScopedLogger("batch-scrape");

type Stream = components["schemas"]["Stream"];
type Container = components["schemas"]["Container"];
type SessionActionBody = {
    action: "select_files" | "update_attributes" | "abort" | "complete";
    files?: Container;
    file_data?: any;
};

async function postSessionAction(session_id: string, body: SessionActionBody) {
    return (providers.riven as any).POST("/api/v1/scrape/session/{session_id}", {
        params: { path: { session_id } },
        body
    });
}

interface ParsedTitleData {
    filename?: string;
    original_filename?: string;
    seasons?: number[];
    episodes?: number[];
    resolution?: string;
    quality?: string;
    hdr?: string[];
    codec?: string;
    audio?: string[];
    languages?: string[];
    complete?: boolean;
}

interface FileMapping {
    file_id: string;
    filename: string;
    filesize: number;
    season?: number;
    episode?: number;
    download_url?: string;
}

interface ProcessBatchItemParams {
    magnet: string;
    mediaType: "movie" | "tv";
    itemId?: string | null;
    externalId: string;
    streams: { magnet: string; stream: Stream }[];
}

export async function processBatchItem({
    magnet,
    mediaType,
    itemId,
    externalId,
    streams
}: ProcessBatchItemParams): Promise<void> {
    // 1. Start Session
    const queryParams: any = {
        media_type: mediaType,
        magnet: `magnet:?xt=urn:btih:${magnet}`
    };
    if (itemId) queryParams.item_id = parseInt(itemId);
    if (externalId) {
        if (mediaType === "movie") queryParams.tmdb_id = externalId;
        if (mediaType === "tv") queryParams.tvdb_id = externalId;
    }

    const { data: sessionData, error: sessionError } = await providers.riven.POST(
        "/api/v1/scrape/start_session",
        {
            params: { query: queryParams }
        }
    );

    if (sessionError || !sessionData) {
        const msg = (sessionError as any)?.message || (sessionError as any)?.detail || "Unknown";
        throw new Error(`Failed to start session for magnet: ${magnet}. Error: ${msg}`);
    }

    const sId = sessionData.session_id;
    const files = sessionData.containers?.files || {};

    // 2. Parse Titles (to auto-select relevant files)
    const fileList = Object.values(files);
    const filenames = fileList.reduce<string[]>((acc, f: any) => {
        if (f.filename) acc.push(f.filename);
        return acc;
    }, []);

    const { data: parseData } = await providers.riven.POST("/api/v1/scrape/parse", {
        body: filenames
    });

    let fileMappings: FileMapping[] = [];
    if (parseData?.data) {
        const parsedList = parseData.data as any[];
        const lookup: Record<string, ParsedTitleData> = {};
        const useIndex = parsedList.length === filenames.length;

        parsedList.forEach((p, i) => {
            const key = p.filename || p.original_filename;
            if (key) {
                lookup[key] = p;
            } else if (useIndex) {
                lookup[filenames[i]] = p;
            }
        });

        fileMappings = fileList.map((file: any, idx: number) => {
            const parsed = file.filename ? lookup[file.filename] : undefined;
            return {
                file_id:
                    file.file_id !== undefined && file.file_id !== null
                        ? String(file.file_id)
                        : String(idx),
                filename: file.filename || "",
                filesize: file.filesize || 0,
                season: parsed?.seasons?.[0],
                episode: parsed?.episodes?.[0],
                download_url: file.download_url
            };
        });
    }

    // 3. Select Files (auto-select based on logic)
    const containerBody: any = {};

    fileMappings.forEach((m) => {
        containerBody[m.file_id] = {
            file_id: parseInt(m.file_id),
            filename: m.filename,
            filesize: m.filesize
        };
    });

    await postSessionAction(sId, {
        action: "select_files",
        files: containerBody
    });

    // 4. Update Attributes
    let updateBody: any;
    if (mediaType === "movie") {
        if (fileMappings.length > 0) {
            const largestFile = fileMappings.reduce((prev, current) =>
                current.filesize > prev.filesize ? current : prev
            );
            updateBody = {
                file_id: parseInt(largestFile.file_id),
                filename: largestFile.filename,
                filesize: largestFile.filesize,
                download_url: largestFile.download_url
            };
        } else {
            // Fallback if no files found?
            updateBody = {};
        }
    } else {
        updateBody = {};

        // Find the stream object to get torrent-level metadata
        const streamObj = streams.find((s) => s.magnet === magnet)?.stream;
        const torrentSeason = streamObj?.parsed_data?.seasons?.[0];

        let mappedCount = 0;
        fileMappings.forEach((mapping) => {
            // Fallback to torrent season if file season is missing
            const season = mapping.season ?? torrentSeason;
            const episode = mapping.episode;

            if (season !== undefined && episode !== undefined) {
                const seasonKey = season.toString();
                const episodeKey = episode.toString();
                if (!updateBody[seasonKey]) {
                    updateBody[seasonKey] = {};
                }
                updateBody[seasonKey][episodeKey] = {
                    file_id: parseInt(mapping.file_id),
                    filename: mapping.filename,
                    filesize: mapping.filesize,
                    download_url: mapping.download_url
                };
                mappedCount++;
            }
        });

        if (mappedCount === 0) {
            logger.warn(`Could not map any files for torrent: ${streamObj?.raw_title || magnet}`);
            // We still proceed to complete session, effectively skipping this torrent but closing the session
        }
    }

    await postSessionAction(sId, {
        action: "update_attributes",
        file_data: updateBody
    });

    // 5. Complete Session
    await postSessionAction(sId, { action: "complete" });
}
