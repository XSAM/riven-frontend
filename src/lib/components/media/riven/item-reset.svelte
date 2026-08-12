<script lang="ts">
    import providers from "$lib/providers";
    import { toast } from "svelte-sonner";
    import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import Loader2 from "@lucide/svelte/icons/loader-2";
    import { createScopedLogger } from "$lib/logger";
    import { invalidateAll } from "$app/navigation";

    const logger = createScopedLogger("item-reset");

    interface Props {
        title: string | null | undefined;
        ids: (string | null | undefined)[];
        variant?:
            | "ghost"
            | "default"
            | "link"
            | "destructive"
            | "outline"
            | "secondary"
            | undefined;
        size?: "default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg" | undefined;
        class?: string;
        buttonLabel?: string;
        description?: string;
        successMessage?: string;
    }
    let {
        title,
        ids,
        variant = "ghost",
        size = "sm",
        buttonLabel = "Reset",
        description,
        successMessage = "Media item reset successfully!",
        ...restProps
    }: Props = $props();

    async function resetMediaItem(ids: (string | null | undefined)[]) {
        const validIds = ids.filter((id): id is string => id !== null && id !== undefined);

        const response = await providers.riven.POST("/api/v1/items/reset", {
            body: {
                ids: validIds
            }
        });

        if (response.data) {
            toast.success(successMessage);
            try {
                await invalidateAll();
            } catch (error) {
                logger.error("Failed to refresh page after reset:", error);
                toast.warning("Media was reset, but the page could not be refreshed.");
            }
            return true;
        } else {
            logger.error("Error response:", response.error);
            toast.error("Failed to reset media item.");
            return false;
        }
    }

    let open = $state(false);
    let loading = $state(false);
</script>

<AlertDialog.Root bind:open>
    <AlertDialog.Trigger>
        {#snippet child({ props })}
            <Button {variant} {size} {...restProps} {...props}>{buttonLabel}</Button>
        {/snippet}
    </AlertDialog.Trigger>
    <AlertDialog.Content>
        <AlertDialog.Header>
            <AlertDialog.Title>
                Resetting "{title ?? "Media Item"}"
            </AlertDialog.Title>
            <AlertDialog.Description>
                {description ??
                    "This will send a request to Riven to reset this media. You will be notified when it's done."}
            </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
                disabled={loading}
                onclick={async () => {
                    loading = true;
                    try {
                        if (await resetMediaItem(ids)) {
                            open = false;
                        }
                    } catch (error) {
                        logger.error("Failed to reset media item:", error);
                        toast.error("Failed to reset media item.");
                    } finally {
                        loading = false;
                    }
                }}>
                {#if loading}
                    <Loader2 class="mr-1 inline-block animate-spin" />
                {/if}
                Reset
            </AlertDialog.Action>
        </AlertDialog.Footer>
    </AlertDialog.Content>
</AlertDialog.Root>
