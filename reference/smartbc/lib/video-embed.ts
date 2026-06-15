// Utility functions for handling different video types (YouTube, Vimeo, direct files)

export type VideoType = "youtube" | "vimeo" | "direct";

export interface VideoInfo {
  type: VideoType;
  id?: string;
  url: string;
}

// Extract YouTube video ID from various YouTube URL formats
function extractYoutubeId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // Format: youtube.com/watch?v=VIDEO_ID or youtu.be/VIDEO_ID
    if (urlObj.hostname.includes("youtube.com") || urlObj.hostname.includes("youtu.be")) {
      const videoId = urlObj.searchParams.get("v") || urlObj.pathname.slice(1);
      if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return videoId;
      }
    }
  } catch {
    // Not a valid URL, treat as direct file
  }
  return null;
}

// Extract Vimeo video ID from Vimeo URL
function extractVimeoId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // Format: vimeo.com/VIDEO_ID
    if (urlObj.hostname.includes("vimeo.com")) {
      const videoId = urlObj.pathname.split("/").pop();
      if (videoId && /^\d+$/.test(videoId)) {
        return videoId;
      }
    }
  } catch {
    // Not a valid URL, treat as direct file
  }
  return null;
}

export function detectVideoType(url: string): VideoInfo {
  if (!url) {
    return { type: "direct", url };
  }

  const youtubeId = extractYoutubeId(url);
  if (youtubeId) {
    return { type: "youtube", id: youtubeId, url };
  }

  const vimeoId = extractVimeoId(url);
  if (vimeoId) {
    return { type: "vimeo", id: vimeoId, url };
  }

  // Default to direct video file
  return { type: "direct", url };
}

// Generate embed URL for YouTube
export function getYoutubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}?rel=0`;
}

// Generate embed URL for Vimeo
export function getVimeoEmbedUrl(videoId: string): string {
  return `https://player.vimeo.com/video/${videoId}`;
}
