import axios from 'axios';

import { PlatformAdapterError } from './platform-errors.js';

const GRAPH_API_VERSION = 'v24.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const MAX_CAPTION_LENGTH = 2_200;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REEL_BYTES = 300 * 1024 * 1024;
const MIN_IMAGE_WIDTH = 320;
const MIN_CAROUSEL_ITEMS = 2;
const MAX_CAROUSEL_ITEMS = 10;
const TERMINAL_CONTAINER_FAILURES = new Set(['ERROR', 'EXPIRED']);

function assertHttpsUrl(value, label) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // Fall through to the stable adapter error.
  }

  throw new PlatformAdapterError(
    'media_url_not_https',
    `${label} must be a valid HTTPS URL`,
    { retryable: false },
  );
}

function mapGraphError(error, fallbackCode) {
  const graphError = error.response?.data?.error;
  if (!graphError) {
    return new PlatformAdapterError(fallbackCode, error.message, { retryable: true });
  }

  const graphCode = graphError.code ? `instagram_${graphError.code}` : fallbackCode;
  const retryableCodes = new Set([1, 2, 4, 17, 32, 341, 613]);

  return new PlatformAdapterError(graphCode, graphError.message || 'Instagram API request failed', {
    retryable: retryableCodes.has(Number(graphError.code)),
    details: {
      type: graphError.type,
      subcode: graphError.error_subcode,
      fbtrace_id: graphError.fbtrace_id,
    },
  });
}

function getInstagramOptions(post) {
  const metadata = post.metadata ?? {};
  return metadata.instagram ?? metadata.instagram_options ?? {};
}

function getRequestedMode(post, media) {
  const options = getInstagramOptions(post);
  const requested = options.media_type ?? options.publish_type;

  if (requested) {
    const normalized = String(requested).toLowerCase();
    if (normalized === 'reels') {
      return 'reel';
    }

    if (normalized === 'photo') {
      return 'image';
    }

    return normalized;
  }

  if (media.length === 1 && media[0].media_kind === 'image') {
    return 'image';
  }

  if (media.length === 1 && media[0].media_kind === 'video') {
    return 'reel';
  }

  if (media.length >= MIN_CAROUSEL_ITEMS) {
    return 'carousel';
  }

  return 'unknown';
}

function validateCaption(post, errors) {
  if ((post.body ?? '').length > MAX_CAPTION_LENGTH) {
    errors.push({
      code: 'caption_too_long',
      message: `Instagram captions must be ${MAX_CAPTION_LENGTH} characters or fewer`,
    });
  }
}

function validateImageMedia(media, errors, index = 0) {
  if (media.media_kind !== 'image') {
    errors.push({ code: 'image_required', message: `Media item ${index + 1} must be an image` });
  }

  if (!media.source_url) {
    errors.push({ code: 'missing_media_url', message: `Media item ${index + 1} is missing source_url` });
  } else if (!String(media.source_url).startsWith('https://')) {
    errors.push({ code: 'media_url_not_https', message: `Media item ${index + 1} must use HTTPS` });
  }

  if (media.bytes && Number(media.bytes) > MAX_IMAGE_BYTES) {
    errors.push({ code: 'image_too_large', message: `Media item ${index + 1} exceeds Instagram image size limits` });
  }

  if (media.width && Number(media.width) < MIN_IMAGE_WIDTH) {
    errors.push({ code: 'image_too_narrow', message: `Media item ${index + 1} must be at least ${MIN_IMAGE_WIDTH}px wide` });
  }
}

function validateVideoMedia(media, errors, index = 0) {
  if (media.media_kind !== 'video') {
    errors.push({ code: 'video_required', message: `Media item ${index + 1} must be a video` });
  }

  if (!media.source_url) {
    errors.push({ code: 'missing_media_url', message: `Media item ${index + 1} is missing source_url` });
  } else if (!String(media.source_url).startsWith('https://')) {
    errors.push({ code: 'media_url_not_https', message: `Media item ${index + 1} must use HTTPS` });
  }

  if (media.bytes && Number(media.bytes) > MAX_REEL_BYTES) {
    errors.push({ code: 'video_too_large', message: `Media item ${index + 1} exceeds Instagram Reel size limits` });
  }
}

function validatePostByMode(post, media, mode) {
  const errors = [];
  const options = getInstagramOptions(post);
  validateCaption(post, errors);

  if (mode === 'image') {
    if (media.length !== 1) {
      errors.push({ code: 'one_image_required', message: 'Instagram image posts require exactly one image' });
    } else {
      validateImageMedia(media[0], errors);
    }
  } else if (mode === 'reel') {
    if (media.length !== 1) {
      errors.push({ code: 'one_video_required', message: 'Instagram Reels require exactly one video' });
    } else {
      validateVideoMedia(media[0], errors);
    }

    if (options.cover_url && !String(options.cover_url).startsWith('https://')) {
      errors.push({ code: 'cover_url_not_https', message: 'Instagram Reel cover_url must use HTTPS' });
    }

    if (options.thumb_offset !== undefined && options.thumb_offset !== null) {
      const thumbOffset = Number.parseInt(options.thumb_offset, 10);
      if (!Number.isInteger(thumbOffset) || thumbOffset < 0) {
        errors.push({ code: 'invalid_thumb_offset', message: 'Instagram Reel thumb_offset must be a non-negative integer' });
      }
    }
  } else if (mode === 'carousel') {
    if (media.length < MIN_CAROUSEL_ITEMS || media.length > MAX_CAROUSEL_ITEMS) {
      errors.push({
        code: 'invalid_carousel_count',
        message: `Instagram carousels require ${MIN_CAROUSEL_ITEMS}-${MAX_CAROUSEL_ITEMS} media items`,
      });
    }

    for (const [index, item] of media.entries()) {
      if (item.media_kind === 'image') {
        validateImageMedia(item, errors, index);
      } else if (item.media_kind === 'video') {
        validateVideoMedia(item, errors, index);
      } else {
        errors.push({ code: 'unsupported_carousel_media', message: `Media item ${index + 1} must be image or video` });
      }
    }
  } else {
    errors.push({
      code: 'unsupported_instagram_media_type',
      message: 'Instagram post must be an image, Reel, or carousel',
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    mode,
  };
}

async function createContainer(target, token, params) {
  try {
    const response = await axios.post(`${GRAPH_BASE_URL}/${target.platform_asset_id}/media`, {
      ...params,
      access_token: token,
    }, {
      timeout: 30_000,
    });

    if (!response.data?.id) {
      throw new PlatformAdapterError(
        'instagram_container_missing_id',
        'Instagram media container response did not include an id',
        { retryable: false },
      );
    }

    return response.data.id;
  } catch (error) {
    if (error instanceof PlatformAdapterError) {
      throw error;
    }

    throw mapGraphError(error, 'instagram_container_create_failed');
  }
}

async function fetchContainerStatus(containerId, token) {
  const response = await axios.get(`${GRAPH_BASE_URL}/${containerId}`, {
    params: {
      fields: 'id,status_code,status',
      access_token: token,
    },
    timeout: 30_000,
  });

  return response.data;
}

function describeContainerStatus(containerId, status) {
  const statusCode = status.status_code ?? null;

  return {
    id: status.id ?? containerId,
    status_code: statusCode,
    status: status.status ?? null,
    finished: statusCode === 'FINISHED',
    terminal: TERMINAL_CONTAINER_FAILURES.has(statusCode),
  };
}

async function waitForContainer(containerId, token, options = {}) {
  const attempts = options.attempts ?? 24;
  const intervalMs = options.intervalMs ?? 5_000;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let status;
    try {
      status = await fetchContainerStatus(containerId, token);
    } catch (error) {
      throw mapGraphError(error, 'instagram_container_status_failed');
    }

    if (status.status_code === 'FINISHED') {
      return status;
    }

    if (TERMINAL_CONTAINER_FAILURES.has(status.status_code)) {
      throw new PlatformAdapterError(
        'instagram_container_failed',
        `Instagram container ${containerId} finished with status ${status.status_code}`,
        { retryable: false, details: { status: status.status } },
      );
    }

    if (attempt < attempts) {
      await new Promise((resolve) => {
        setTimeout(resolve, intervalMs);
      });
    }
  }

  throw new PlatformAdapterError(
    'instagram_container_timeout',
    `Instagram container ${containerId} did not finish processing`,
    { retryable: true },
  );
}

async function publishMediaContainer(target, token, creationId) {
  try {
    const response = await axios.post(`${GRAPH_BASE_URL}/${target.platform_asset_id}/media_publish`, {
      creation_id: creationId,
      access_token: token,
    }, {
      timeout: 30_000,
    });

    if (!response.data?.id) {
      throw new PlatformAdapterError(
        'instagram_publish_missing_id',
        'Instagram publish response did not include an id',
        { retryable: false },
      );
    }

    return response.data.id;
  } catch (error) {
    if (error instanceof PlatformAdapterError) {
      throw error;
    }

    throw mapGraphError(error, 'instagram_publish_failed');
  }
}

async function getPermalink(mediaId, token) {
  try {
    const response = await axios.get(`${GRAPH_BASE_URL}/${mediaId}`, {
      params: {
        fields: 'id,permalink',
        access_token: token,
      },
      timeout: 30_000,
    });

    return response.data?.permalink ?? null;
  } catch {
    return null;
  }
}

function getMediaUrl(media) {
  return assertHttpsUrl(media.source_url, 'Instagram media URL');
}

function buildReelContainerParams(post, media) {
  const options = getInstagramOptions(post);
  const params = {
    media_type: 'REELS',
    video_url: getMediaUrl(media[0]),
    caption: post.body,
    share_to_feed: options.share_to_feed !== false,
  };

  if (options.cover_url) {
    params.cover_url = assertHttpsUrl(options.cover_url, 'Instagram Reel cover URL');
  }

  if (options.thumb_offset !== undefined && options.thumb_offset !== null) {
    params.thumb_offset = Number.parseInt(options.thumb_offset, 10);
  }

  return params;
}

function assertReelValidation(validation) {
  if (!validation.ok) {
    throw new PlatformAdapterError(
      validation.errors[0].code,
      validation.errors[0].message,
      { retryable: false, details: { validation_errors: validation.errors } },
    );
  }

  if (validation.mode !== 'reel') {
    throw new PlatformAdapterError(
      'instagram_reel_required',
      'This operation only supports Instagram Reel video containers',
      { retryable: false },
    );
  }
}

async function publishImage(target, token, post, media) {
  const containerId = await createContainer(target, token, {
    image_url: getMediaUrl(media[0]),
    caption: post.body,
  });
  await waitForContainer(containerId, token);
  const mediaId = await publishMediaContainer(target, token, containerId);

  return {
    mediaId,
    containerIds: [containerId],
  };
}

async function publishReel(target, token, post, media) {
  const containerId = await createContainer(target, token, buildReelContainerParams(post, media));
  await waitForContainer(containerId, token);
  const mediaId = await publishMediaContainer(target, token, containerId);

  return {
    mediaId,
    containerIds: [containerId],
  };
}

async function createCarouselChild(target, token, media) {
  const params = media.media_kind === 'video'
    ? {
      media_type: 'VIDEO',
      video_url: getMediaUrl(media),
      is_carousel_item: true,
    }
    : {
      image_url: getMediaUrl(media),
      is_carousel_item: true,
    };

  const containerId = await createContainer(target, token, params);
  await waitForContainer(containerId, token);
  return containerId;
}

async function publishCarousel(target, token, post, media) {
  const childIds = [];

  for (const item of media) {
    childIds.push(await createCarouselChild(target, token, item));
  }

  const parentId = await createContainer(target, token, {
    media_type: 'CAROUSEL',
    caption: post.body,
    children: childIds.join(','),
  });
  await waitForContainer(parentId, token);
  const mediaId = await publishMediaContainer(target, token, parentId);

  return {
    mediaId,
    containerIds: [...childIds, parentId],
  };
}

export const instagramProfileAdapter = Object.freeze({
  platform: 'instagram',
  tokenType: 'page',

  validatePost({ post, target, media }) {
    if (target.asset_type !== 'profile') {
      return {
        ok: false,
        errors: [{ code: 'unsupported_asset_type', message: 'Instagram adapter supports profile assets only' }],
      };
    }

    return validatePostByMode(post, media, getRequestedMode(post, media));
  },

  async checkAuth({ target, token }) {
    try {
      const response = await axios.get(`${GRAPH_BASE_URL}/${target.platform_asset_id}`, {
        params: {
          fields: 'id,username',
          access_token: token,
        },
        timeout: 30_000,
      });

      if (response.data?.id !== target.platform_asset_id) {
        throw new PlatformAdapterError(
          'token_asset_mismatch',
          'Instagram token returned a different account than the target asset',
          { retryable: false },
        );
      }

      return {
        ok: true,
        provider_account_id: response.data.id,
        display_name: response.data.username,
      };
    } catch (error) {
      if (error instanceof PlatformAdapterError) {
        throw error;
      }

      throw mapGraphError(error, 'instagram_auth_check_failed');
    }
  },

  async createReelContainer({ post, target, media, token }) {
    const validation = this.validatePost({ post, target, media });
    assertReelValidation(validation);

    const containerId = await createContainer(target, token, buildReelContainerParams(post, media));

    return {
      platformContainerId: containerId,
      containerIds: [containerId],
      platformResponse: {
        id: containerId,
        status: 'container_created',
        status_check_required: true,
      },
    };
  },

  async getContainerStatus({ platformContainerId, token }) {
    try {
      const status = await fetchContainerStatus(platformContainerId, token);

      return {
        platformContainerId,
        platformResponse: describeContainerStatus(platformContainerId, status),
      };
    } catch (error) {
      throw mapGraphError(error, 'instagram_container_status_failed');
    }
  },

  async publishContainer({ target, platformContainerId, token }) {
    let status;
    try {
      status = await fetchContainerStatus(platformContainerId, token);
    } catch (error) {
      throw mapGraphError(error, 'instagram_container_status_failed');
    }

    const describedStatus = describeContainerStatus(platformContainerId, status);

    if (describedStatus.terminal) {
      throw new PlatformAdapterError(
        'instagram_container_failed',
        `Instagram container ${platformContainerId} finished with status ${describedStatus.status_code}`,
        { retryable: false, details: { status: describedStatus.status } },
      );
    }

    if (!describedStatus.finished) {
      throw new PlatformAdapterError(
        'instagram_container_not_ready',
        `Instagram container ${platformContainerId} is not ready to publish`,
        { retryable: true, details: describedStatus },
      );
    }

    const mediaId = await publishMediaContainer(target, token, platformContainerId);
    const permalink = await getPermalink(mediaId, token);

    return {
      platformPostId: mediaId,
      permalinkUrl: permalink,
      platformResponse: {
        id: mediaId,
        container_id: platformContainerId,
        permalink,
      },
    };
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

    let publish;
    if (validation.mode === 'image') {
      publish = await publishImage(target, token, post, media);
    } else if (validation.mode === 'reel') {
      publish = await publishReel(target, token, post, media);
    } else {
      publish = await publishCarousel(target, token, post, media);
    }

    const permalink = await getPermalink(publish.mediaId, token);

    return {
      platformPostId: publish.mediaId,
      permalinkUrl: permalink,
      platformResponse: {
        id: publish.mediaId,
        container_ids: publish.containerIds,
        permalink,
      },
    };
  },
});
