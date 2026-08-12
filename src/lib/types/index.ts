import type { components } from "$lib/providers/riven";

export type AutoScrapeRequest = components["schemas"]["AutoScrapeRequest"];

export interface ScrapeSeasonRequest extends AutoScrapeRequest {
    season_numbers: number[];
}

export type { RivenMediaItem } from "./riven";
