import axios from 'axios';

import { PlatformAdapterError } from './platform-errors.js';

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const VIDEO_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const THUMBNAIL_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';
const MAX_YOUTUBE_TITLE_LENGTH = 100;
const MAX_YOUTUBE_DESCRIPTION_LENGTH = 5_000;
const MAX_YOUTUBE_TAG_LENGTH = 500;
const MAX_YOUTUBE_VIDEO_BYTES = Number(process.env.YOUTUBE_MAX_UPLOAD_BYTES ?? 512 * 1024 * 1024);
const MAX_YOUTUBE_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const VALID_PRIVACY_STATUSES = new Set(['private', 'unlisted', 'public']);
const YOUTUBE_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime']);
const YOUTUBE_THUMBNAIL_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

function readRequiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new PlatformAdapterError(
      'missing_youtube_config',
      `${name} is required for YouTube publishing`,
      { retryable: false, details: { env: name } },
    );
  }

  return value;
}

function parseToken(token) {
  try {
    const parsed = JSON.parse(token);
    if (typeof parsed.refreshToken === 'string' && parsed.refreshToken.length > 0) {
      return {
        refreshToken: parsed.refreshToken,
        tokenUri: parsed.tokenUri ?? DEFAULT_TOKEN_URI,
        scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [],
      };
    }
  } catch {
    // Fall through to stable adapter error.
  }

  throw new PlatformAdapterError(
    'invalid_youtube_token',
    'Encrypted YouTube refresh token payload is malformed',
    { retryable: false },
  );
}

function mapYouTubeError(error, fallbackCode) {
  if (error instanceof PlatformAdapterError) {
    return error;
  }

  const status = error.response?.status;
  const body = error.response?.data;
  const googleError = body?.error;
  const oauthError = typeof googleError === 'string' ? googleError : undefined;
  const oauthMessage = typeof body?.error_description === 'string' ? body.error_description : undefined;
  const reason = googleError?.errors?.[0]?.reason;
  const message = oauthMessage || googleError?.message || error.message || 'YouTube API request failed';
  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
  const retryableReasons = new Set(['backendError', 'internalError', 'rateLimitExceeded', 'temporarily_unavailable']);
  const mappedReason = oauthError || reason;

  return new PlatformAdapterError(mappedReason ? `youtube_${mappedReason}` : fallbackCode, message, {
    retryable: retryableStatuses.has(status) || retryableReasons.has(mappedReason),
    details: {
      status,
      reason: mappedReason,
      code: typeof googleError === 'object' ? googleError?.code : undefined,
    },
  });
}

function assertHttpsUrl(value, label) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // Fall through to stable adapter error.
  }

  throw new PlatformAdapterError(
    'media_url_not_https',
    `${label} must be a valid HTTPS URL`,
    { retryable: false },
  );
}

function getYouTubeOptions(post) {
  const metadata = post.metadata ?? {};
  return metadata.youtube ?? metadata.youtube_options ?? {};
}

function hasField(object, snakeName, camelName = snakeName) {
  return Object.prototype.hasOwnProperty.call(object, snakeName)
    || Object.prototype.hasOwnProperty.call(object, camelName);
}

function getTitle(post) {
  const options = getYouTubeOptions(post);
  return String(options.title ?? post.title ?? '').trim();
}

function getOptionalTitle(post) {
  const options = getYouTubeOptions(post);
  if (hasField(options, 'title')) {
    return String(options.title ?? '').trim();
  }

  if (hasField(post, 'title')) {
    return String(post.title ?? '').trim();
  }

  return undefined;
}

function getDescription(post) {
  const options = getYouTubeOptions(post);
  return String(options.description ?? post.body ?? '').trim();
}

function getOptionalDescription(post) {
  const options = getYouTubeOptions(post);
  if (hasField(options, 'description')) {
    return String(options.description ?? '').trim();
  }

  if (hasField(post, 'body')) {
    return String(post.body ?? '').trim();
  }

  return undefined;
}

function getPrivacyStatus(post) {
  const options = getYouTubeOptions(post);
  return String(options.privacy_status ?? options.privacy ?? 'private').toLowerCase();
}

function getOptionalPrivacyStatus(post) {
  const options = getYouTubeOptions(post);
  if (!hasField(options, 'privacy_status', 'privacy')) {
    return undefined;
  }

  return String(options.privacy_status ?? options.privacy ?? '').toLowerCase();
}

function getCategoryId(post) {
  const options = getYouTubeOptions(post);
  return String(options.category_id ?? options.categoryId ?? '22');
}

function getOptionalCategoryId(post) {
  const options = getYouTubeOptions(post);
  if (!hasField(options, 'category_id', 'categoryId')) {
    return undefined;
  }

  return String(options.category_id ?? options.categoryId ?? '').trim();
}

function getTags(post) {
  const options = getYouTubeOptions(post);
  const tags = options.tags;

  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }

  if (typeof tags === 'string') {
    return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  }

  return [];
}

function hasTags(post) {
  return hasField(getYouTubeOptions(post), 'tags');
}

function getMadeForKids(post) {
  const options = getYouTubeOptions(post);
  return options.made_for_kids === true || options.self_declared_made_for_kids === true;
}

function getPublishAt(post) {
  const options = getYouTubeOptions(post);
  return options.publish_at ?? options.publishAt ?? null;
}

function getOptionalPublishAt(post) {
  const options = getYouTubeOptions(post);
  if (!hasField(options, 'publish_at', 'publishAt')) {
    return undefined;
  }

  return options.publish_at ?? options.publishAt ?? null;
}

function assertVideoId(videoId) {
  if (typeof videoId !== 'string' || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    throw new PlatformAdapterError(
      'invalid_youtube_video_id',
      'YouTube video id is malformed',
      { retryable: false },
    );
  }

  return videoId;
}

function splitMedia(media) {
  return {
    videos: media.filter((item) => item.media_kind === 'video'),
    thumbnails: media.filter((item) => item.media_kind === 'image'),
    unsupported: media.filter((item) => !['video', 'image'].includes(item.media_kind)),
  };
}

function validateVideoMedia(item, errors) {
  if (!item.source_url) {
    errors.push({ code: 'missing_video_url', message: 'YouTube video media is missing source_url' });
  } else if (!String(item.source_url).startsWith('https://')) {
    errors.push({ code: 'media_url_not_https', message: 'YouTube video media must use HTTPS' });
  }

  if (item.mime_type && !YOUTUBE_VIDEO_MIME_TYPES.has(String(item.mime_type).toLowerCase())) {
    errors.push({ code: 'unsupported_video_mime_type', message: 'YouTube video media must be MP4 or MOV' });
  }

  if (item.bytes && Number(item.bytes) > MAX_YOUTUBE_VIDEO_BYTES) {
    errors.push({ code: 'video_too_large', message: 'YouTube video media exceeds the configured upload size limit' });
  }
}

function validateThumbnailMedia(item, errors) {
  if (!item.source_url) {
    errors.push({ code: 'missing_thumbnail_url', message: 'YouTube thumbnail media is missing source_url' });
  } else if (!String(item.source_url).startsWith('https://')) {
    errors.push({ code: 'media_url_not_https', message: 'YouTube thumbnail media must use HTTPS' });
  }

  if (item.mime_type && !YOUTUBE_THUMBNAIL_MIME_TYPES.has(String(item.mime_type).toLowerCase())) {
    errors.push({ code: 'unsupported_thumbnail_mime_type', message: 'YouTube thumbnails must be JPEG or PNG' });
  }

  if (item.bytes && Number(item.bytes) > MAX_YOUTUBE_THUMBNAIL_BYTES) {
    errors.push({ code: 'thumbnail_too_large', message: 'YouTube thumbnails must be 2MB or smaller' });
  }
}

function validatePostInput(post, target, media) {
  const errors = [];
  const title = getTitle(post);
  const description = getDescription(post);
  const privacyStatus = getPrivacyStatus(post);
  const publishAt = getPublishAt(post);
  const tags = getTags(post);
  const { videos, thumbnails, unsupported } = splitMedia(media);

  if (target.asset_type !== 'channel') {
    errors.push({ code: 'unsupported_asset_type', message: 'YouTube adapter supports channel assets only' });
  }

  if (!title) {
    errors.push({ code: 'missing_title', message: 'YouTube uploads require a title' });
  } else if (title.length > MAX_YOUTUBE_TITLE_LENGTH) {
    errors.push({ code: 'title_too_long', message: `YouTube title must be ${MAX_YOUTUBE_TITLE_LENGTH} characters or fewer` });
  }

  if (description.length > MAX_YOUTUBE_DESCRIPTION_LENGTH) {
    errors.push({
      code: 'description_too_long',
      message: `YouTube description must be ${MAX_YOUTUBE_DESCRIPTION_LENGTH} characters or fewer`,
    });
  }

  if (!VALID_PRIVACY_STATUSES.has(privacyStatus)) {
    errors.push({ code: 'invalid_privacy_status', message: 'YouTube privacy must be private, unlisted, or public' });
  }

  if (publishAt) {
    const parsed = Date.parse(publishAt);
    if (!Number.isFinite(parsed)) {
      errors.push({ code: 'invalid_publish_at', message: 'YouTube publish_at must be a valid ISO datetime' });
    } else if (privacyStatus !== 'private') {
      errors.push({ code: 'scheduled_upload_must_be_private', message: 'Scheduled YouTube uploads must use private privacy status' });
    }
  }

  if (tags.join(',').length > MAX_YOUTUBE_TAG_LENGTH) {
    errors.push({ code: 'tags_too_long', message: `YouTube tags must be ${MAX_YOUTUBE_TAG_LENGTH} characters or fewer in total` });
  }

  if (videos.length !== 1) {
    errors.push({ code: 'one_video_required', message: 'YouTube uploads require exactly one video media item' });
  } else {
    validateVideoMedia(videos[0], errors);
  }

  if (thumbnails.length > 1) {
    errors.push({ code: 'too_many_thumbnails', message: 'YouTube uploads support at most one thumbnail image' });
  } else if (thumbnails.length === 1) {
    validateThumbnailMedia(thumbnails[0], errors);
  }

  if (unsupported.length > 0) {
    errors.push({ code: 'unsupported_media_type', message: 'YouTube uploads only support one video and optional one image thumbnail' });
  }

  return {
    ok: errors.length === 0,
    errors,
    mode: thumbnails.length === 1 ? 'video_with_thumbnail' : 'video',
  };
}

function validateUpdateInput(post) {
  const errors = [];
  const title = getOptionalTitle(post);
  const description = getOptionalDescription(post);
  const privacyStatus = getOptionalPrivacyStatus(post);
  const publishAt = getOptionalPublishAt(post);
  const tags = getTags(post);

  if (title !== undefined && title.length === 0) {
    errors.push({ code: 'missing_title', message: 'YouTube title cannot be empty when updating metadata' });
  } else if (title && title.length > MAX_YOUTUBE_TITLE_LENGTH) {
    errors.push({ code: 'title_too_long', message: `YouTube title must be ${MAX_YOUTUBE_TITLE_LENGTH} characters or fewer` });
  }

  if (description !== undefined && description.length > MAX_YOUTUBE_DESCRIPTION_LENGTH) {
    errors.push({
      code: 'description_too_long',
      message: `YouTube description must be ${MAX_YOUTUBE_DESCRIPTION_LENGTH} characters or fewer`,
    });
  }

  if (privacyStatus !== undefined && !VALID_PRIVACY_STATUSES.has(privacyStatus)) {
    errors.push({ code: 'invalid_privacy_status', message: 'YouTube privacy must be private, unlisted, or public' });
  }

  if (publishAt !== undefined && publishAt !== null) {
    const parsed = Date.parse(publishAt);
    if (!Number.isFinite(parsed)) {
      errors.push({ code: 'invalid_publish_at', message: 'YouTube publish_at must be a valid ISO datetime' });
    } else if ((privacyStatus ?? 'private') !== 'private') {
      errors.push({ code: 'scheduled_upload_must_be_private', message: 'Scheduled YouTube uploads must use private privacy status' });
    }
  }

  if (hasTags(post) && tags.join(',').length > MAX_YOUTUBE_TAG_LENGTH) {
    errors.push({ code: 'tags_too_long', message: `YouTube tags must be ${MAX_YOUTUBE_TAG_LENGTH} characters or fewer in total` });
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

async function refreshAccessToken(refreshCredential) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshCredential.refreshToken,
    client_id: readRequiredEnv('GOOGLE_CLIENT_ID'),
    client_secret: readRequiredEnv('GOOGLE_CLIENT_SECRET'),
  });

  const response = await axios.post(refreshCredential.tokenUri ?? DEFAULT_TOKEN_URI, params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 30_000,
  });

  if (!response.data?.access_token) {
    throw new PlatformAdapterError(
      'youtube_access_token_missing',
      'Google token refresh response did not include an access token',
      { retryable: false },
    );
  }

  return response.data.access_token;
}

async function getChannelInfo(accessToken) {
  const response = await axios.get(CHANNELS_URL, {
    params: {
      part: 'id,snippet',
      mine: 'true',
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 30_000,
  });
  const channel = response.data?.items?.[0];

  if (!channel?.id) {
    throw new PlatformAdapterError(
      'youtube_channel_missing',
      'YouTube channels response did not include a channel id',
      { retryable: false },
    );
  }

  return {
    id: channel.id,
    title: channel.snippet?.title ?? 'YouTube Channel',
  };
}

async function getVideoInfo(accessToken, videoId) {
  const response = await axios.get(VIDEOS_URL, {
    params: {
      part: 'snippet,status',
      id: assertVideoId(videoId),
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 30_000,
  });
  const video = response.data?.items?.[0];

  if (!video?.id) {
    throw new PlatformAdapterError(
      'youtube_video_not_found',
      'YouTube video was not found or is not accessible with this token',
      { retryable: false },
    );
  }

  return video;
}

async function downloadMedia(item, maxBytes, label) {
  const response = await axios.get(assertHttpsUrl(item.source_url, label), {
    responseType: 'arraybuffer',
    timeout: 120_000,
    maxContentLength: maxBytes,
  });
  const buffer = Buffer.from(response.data);

  if (buffer.length > maxBytes) {
    throw new PlatformAdapterError(
      item.media_kind === 'video' ? 'video_too_large' : 'thumbnail_too_large',
      `${label} exceeds the configured size limit`,
      { retryable: false },
    );
  }

  return buffer;
}

function buildVideoResource(post) {
  const publishAt = getPublishAt(post);
  const status = {
    privacyStatus: getPrivacyStatus(post),
    selfDeclaredMadeForKids: getMadeForKids(post),
  };

  if (publishAt) {
    status.publishAt = new Date(publishAt).toISOString();
  }

  return {
    snippet: {
      title: getTitle(post),
      description: getDescription(post),
      tags: getTags(post),
      categoryId: getCategoryId(post),
    },
    status,
  };
}

async function initiateResumableUpload(accessToken, videoResource, video, videoBytes) {
  const response = await axios.post(VIDEO_UPLOAD_URL, videoResource, {
    params: {
      uploadType: 'resumable',
      part: 'snippet,status',
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': video.mime_type || 'video/mp4',
      'X-Upload-Content-Length': String(videoBytes),
    },
    maxBodyLength: 1024 * 1024,
    timeout: 30_000,
  });
  const uploadUrl = response.headers?.location;

  if (!uploadUrl) {
    throw new PlatformAdapterError(
      'youtube_resumable_upload_url_missing',
      'YouTube upload initialization response did not include a resumable upload URL',
      { retryable: false },
    );
  }

  return uploadUrl;
}

async function uploadVideo(accessToken, post, video) {
  const videoBuffer = await downloadMedia(video, MAX_YOUTUBE_VIDEO_BYTES, 'YouTube video URL');
  const uploadUrl = await initiateResumableUpload(accessToken, buildVideoResource(post), video, videoBuffer.length);
  const response = await axios.put(uploadUrl, videoBuffer, {
    headers: {
      'Content-Type': video.mime_type || 'video/mp4',
      'Content-Length': String(videoBuffer.length),
    },
    maxBodyLength: videoBuffer.length + 1024 * 1024,
    timeout: 30 * 60_000,
  });
  const videoId = response.data?.id;

  if (!videoId) {
    throw new PlatformAdapterError(
      'youtube_video_id_missing',
      'YouTube upload response did not include a video id',
      { retryable: false },
    );
  }

  return response.data;
}

async function uploadThumbnail(accessToken, videoId, thumbnail) {
  const thumbnailBuffer = await downloadMedia(thumbnail, MAX_YOUTUBE_THUMBNAIL_BYTES, 'YouTube thumbnail URL');
  const response = await axios.post(THUMBNAIL_UPLOAD_URL, thumbnailBuffer, {
    params: {
      videoId,
      uploadType: 'media',
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': thumbnail.mime_type || 'image/jpeg',
      'Content-Length': String(thumbnailBuffer.length),
    },
    maxBodyLength: thumbnailBuffer.length + 1024 * 1024,
    timeout: 60_000,
  });

  return response.data ?? {};
}

function buildVideoUpdateResource(videoId, existingVideo, post) {
  const snippet = {
    title: existingVideo.snippet?.title,
    description: existingVideo.snippet?.description ?? '',
    tags: existingVideo.snippet?.tags ?? [],
    categoryId: existingVideo.snippet?.categoryId ?? '22',
  };
  if (existingVideo.snippet?.defaultLanguage) {
    snippet.defaultLanguage = existingVideo.snippet.defaultLanguage;
  }
  if (existingVideo.snippet?.defaultAudioLanguage) {
    snippet.defaultAudioLanguage = existingVideo.snippet.defaultAudioLanguage;
  }

  const title = getOptionalTitle(post);
  const description = getOptionalDescription(post);
  const tags = getTags(post);
  const categoryId = getOptionalCategoryId(post);
  const privacyStatus = getOptionalPrivacyStatus(post);
  const publishAt = getOptionalPublishAt(post);
  const status = {
    privacyStatus: existingVideo.status?.privacyStatus ?? 'private',
  };
  if (existingVideo.status?.license) {
    status.license = existingVideo.status.license;
  }
  if (existingVideo.status?.embeddable !== undefined) {
    status.embeddable = existingVideo.status.embeddable;
  }
  if (existingVideo.status?.publicStatsViewable !== undefined) {
    status.publicStatsViewable = existingVideo.status.publicStatsViewable;
  }
  if (existingVideo.status?.selfDeclaredMadeForKids !== undefined) {
    status.selfDeclaredMadeForKids = existingVideo.status.selfDeclaredMadeForKids;
  }

  const parts = ['snippet'];

  if (title !== undefined) {
    snippet.title = title;
  }

  if (description !== undefined) {
    snippet.description = description;
  }

  if (hasTags(post)) {
    snippet.tags = tags;
  }

  if (categoryId !== undefined) {
    snippet.categoryId = categoryId;
  }

  if (privacyStatus !== undefined) {
    status.privacyStatus = privacyStatus;
  }

  if (publishAt !== undefined) {
    if (publishAt === null || publishAt === '') {
      delete status.publishAt;
    } else {
      status.publishAt = new Date(publishAt).toISOString();
    }
  }

  if (privacyStatus !== undefined || publishAt !== undefined) {
    parts.push('status');
  }

  return {
    params: { part: parts.join(',') },
    body: {
      id: videoId,
      snippet,
      ...(parts.includes('status') ? { status } : {}),
    },
  };
}

async function updateVideoMetadata(accessToken, videoId, post) {
  const validation = validateUpdateInput(post);
  if (!validation.ok) {
    throw new PlatformAdapterError(
      validation.errors[0].code,
      validation.errors[0].message,
      { retryable: false, details: { validation_errors: validation.errors } },
    );
  }

  const existingVideo = await getVideoInfo(accessToken, videoId);
  const update = buildVideoUpdateResource(videoId, existingVideo, post);
  const response = await axios.put(VIDEOS_URL, update.body, {
    params: update.params,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    timeout: 30_000,
  });

  return response.data;
}

async function deleteVideo(accessToken, videoId) {
  await axios.delete(VIDEOS_URL, {
    params: {
      id: assertVideoId(videoId),
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 30_000,
  });
}

async function withAccessToken(token, callback) {
  const refreshCredential = parseToken(token);
  const accessToken = await refreshAccessToken(refreshCredential);
  return callback(accessToken);
}

export const youtubeChannelAdapter = Object.freeze({
  platform: 'youtube',
  tokenType: 'refresh',

  validatePost({ post, target, media }) {
    return validatePostInput(post, target, media);
  },

  async checkAuth({ target, token }) {
    try {
      const channel = await withAccessToken(token, (accessToken) => getChannelInfo(accessToken));
      const targetId = target?.platform_asset_id;
      const allowsSelfTarget = ['self', 'me', 'preview', ''].includes(targetId);

      if (!allowsSelfTarget && channel.id !== targetId) {
        throw new PlatformAdapterError(
          'token_asset_mismatch',
          'YouTube token returned a different channel than the target asset',
          { retryable: false },
        );
      }

      return {
        ok: true,
        provider_account_id: channel.id,
        display_name: channel.title,
      };
    } catch (error) {
      throw mapYouTubeError(error, 'youtube_auth_check_failed');
    }
  },

  async publish({ post, target, media, token }) {
    const validation = this.validatePost({ post, target, media });
    if (!validation.ok) {
      throw new PlatformAdapterError(
        validation.errors[0].code,
        validation.errors[0].message,
        { retryable: false, details: { validation_errors: validation.errors } },
      );
    }

    try {
      const { videos, thumbnails } = splitMedia(media);

      return await withAccessToken(token, async (accessToken) => {
        const uploaded = await uploadVideo(accessToken, post, videos[0]);
        let thumbnailResponse = null;

        if (thumbnails[0]) {
          thumbnailResponse = await uploadThumbnail(accessToken, uploaded.id, thumbnails[0]);
        }

        return {
          platformPostId: uploaded.id,
          permalinkUrl: `https://www.youtube.com/watch?v=${uploaded.id}`,
          platformResponse: {
            id: uploaded.id,
            privacy_status: uploaded.status?.privacyStatus,
            title: uploaded.snippet?.title,
            thumbnail_uploaded: Boolean(thumbnailResponse),
          },
        };
      });
    } catch (error) {
      throw mapYouTubeError(error, 'youtube_publish_failed');
    }
  },

  async updatePost({ platformPostId, post, token }) {
    try {
      const videoId = assertVideoId(platformPostId);
      const updated = await withAccessToken(token, (accessToken) => updateVideoMetadata(accessToken, videoId, post));

      return {
        platformPostId: updated.id ?? videoId,
        permalinkUrl: `https://www.youtube.com/watch?v=${updated.id ?? videoId}`,
        platformResponse: {
          id: updated.id ?? videoId,
          title: updated.snippet?.title,
          privacy_status: updated.status?.privacyStatus,
          updated: true,
        },
      };
    } catch (error) {
      throw mapYouTubeError(error, 'youtube_update_failed');
    }
  },

  async updateThumbnail({ platformPostId, thumbnail, token }) {
    try {
      const videoId = assertVideoId(platformPostId);
      const response = await withAccessToken(token, (accessToken) => uploadThumbnail(accessToken, videoId, thumbnail));

      return {
        platformPostId: videoId,
        permalinkUrl: `https://www.youtube.com/watch?v=${videoId}`,
        platformResponse: {
          id: videoId,
          thumbnail_uploaded: true,
          thumbnail_response: response,
        },
      };
    } catch (error) {
      throw mapYouTubeError(error, 'youtube_thumbnail_update_failed');
    }
  },

  async deletePost({ platformPostId, token }) {
    try {
      const videoId = assertVideoId(platformPostId);
      await withAccessToken(token, (accessToken) => deleteVideo(accessToken, videoId));

      return {
        platformPostId: videoId,
        permalinkUrl: null,
        platformResponse: {
          id: videoId,
          deleted: true,
        },
      };
    } catch (error) {
      throw mapYouTubeError(error, 'youtube_delete_failed');
    }
  },
});
