import assert from 'node:assert/strict';
import test from 'node:test';

import axios from 'axios';

import { instagramProfileAdapter } from '../../src/adapters/instagram-profile.js';

const target = Object.freeze({
  asset_type: 'profile',
  platform_asset_id: '17841401750110537',
});

function post(metadata = {}) {
  return {
    body: 'Caption',
    metadata,
  };
}

function reelVideo() {
  return {
    media_kind: 'video',
    source_url: 'https://example.com/video.mp4',
    mime_type: 'video/mp4',
    bytes: 1024,
  };
}

function mockAxios(methods) {
  const original = {
    get: axios.get,
    post: axios.post,
  };

  axios.get = methods.get ?? (async () => ({ data: {} }));
  axios.post = methods.post ?? (async () => ({ data: {} }));

  return () => {
    axios.get = original.get;
    axios.post = original.post;
  };
}

test('instagram adapter validates a single hosted image post', () => {
  const result = instagramProfileAdapter.validatePost({
    post: post(),
    target,
    media: [{
      media_kind: 'image',
      source_url: 'https://example.com/image.jpg',
      mime_type: 'image/jpeg',
      width: 1080,
      bytes: 1024,
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'image');
});

test('instagram adapter validates a single hosted video as a reel', () => {
  const result = instagramProfileAdapter.validatePost({
    post: post(),
    target,
    media: [{
      media_kind: 'video',
      source_url: 'https://example.com/video.mp4',
      mime_type: 'video/mp4',
      bytes: 1024,
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'reel');
});

test('instagram adapter rejects non-HTTPS media URLs', () => {
  const result = instagramProfileAdapter.validatePost({
    post: post(),
    target,
    media: [{
      media_kind: 'image',
      source_url: 'http://example.com/image.jpg',
      mime_type: 'image/jpeg',
    }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'media_url_not_https');
});

test('instagram adapter validates carousel item count', () => {
  const result = instagramProfileAdapter.validatePost({
    post: post({ instagram: { media_type: 'carousel' } }),
    target,
    media: [{
      media_kind: 'image',
      source_url: 'https://example.com/image.jpg',
      mime_type: 'image/jpeg',
    }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'invalid_carousel_count');
});

test('instagram adapter stages a reel container without polling or publishing', async () => {
  const calls = [];
  const restoreAxios = mockAxios({
    post: async (url, body) => {
      calls.push({ url, body });
      return { data: { id: 'container_123' } };
    },
    get: async () => {
      throw new Error('status polling should not run while only creating a container');
    },
  });

  try {
    const result = await instagramProfileAdapter.createReelContainer({
      post: post({ instagram: { share_to_feed: false } }),
      target,
      media: [reelVideo()],
      token: 'page-token',
    });

    assert.equal(result.platformContainerId, 'container_123');
    assert.deepEqual(result.containerIds, ['container_123']);
    assert.equal(result.platformResponse.status, 'container_created');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/media$/);
    assert.equal(calls[0].body.media_type, 'REELS');
    assert.equal(calls[0].body.share_to_feed, false);
  } finally {
    restoreAxios();
  }
});

test('instagram adapter checks container status without creating another container', async () => {
  let createCalls = 0;
  const restoreAxios = mockAxios({
    get: async (url) => {
      assert.match(url, /\/container_123$/);
      return {
        data: {
          id: 'container_123',
          status_code: 'IN_PROGRESS',
          status: 'Processing',
        },
      };
    },
    post: async () => {
      createCalls += 1;
      throw new Error('status checks must not create or publish media');
    },
  });

  try {
    const result = await instagramProfileAdapter.getContainerStatus({
      platformContainerId: 'container_123',
      token: 'page-token',
    });

    assert.equal(result.platformContainerId, 'container_123');
    assert.equal(result.platformResponse.status_code, 'IN_PROGRESS');
    assert.equal(result.platformResponse.finished, false);
    assert.equal(result.platformResponse.terminal, false);
    assert.equal(createCalls, 0);
  } finally {
    restoreAxios();
  }
});

test('instagram adapter refuses to publish an unfinished existing container', async () => {
  let publishCalls = 0;
  const restoreAxios = mockAxios({
    get: async () => ({
      data: {
        id: 'container_123',
        status_code: 'IN_PROGRESS',
        status: 'Processing',
      },
    }),
    post: async () => {
      publishCalls += 1;
      throw new Error('unfinished containers must not be published');
    },
  });

  try {
    await assert.rejects(
      () => instagramProfileAdapter.publishContainer({
        target,
        platformContainerId: 'container_123',
        token: 'page-token',
      }),
      (error) => {
        assert.equal(error.name, 'PlatformAdapterError');
        assert.equal(error.code, 'instagram_container_not_ready');
        assert.equal(error.retryable, true);
        return true;
      },
    );
    assert.equal(publishCalls, 0);
  } finally {
    restoreAxios();
  }
});

test('instagram adapter publishes a finished existing container', async () => {
  let publishBody;
  const restoreAxios = mockAxios({
    get: async (url) => {
      if (url.endsWith('/container_123')) {
        return {
          data: {
            id: 'container_123',
            status_code: 'FINISHED',
            status: 'Finished',
          },
        };
      }

      return {
        data: {
          id: 'media_456',
          permalink: 'https://www.instagram.com/reel/example/',
        },
      };
    },
    post: async (url, body) => {
      assert.match(url, /\/media_publish$/);
      publishBody = body;
      return { data: { id: 'media_456' } };
    },
  });

  try {
    const result = await instagramProfileAdapter.publishContainer({
      target,
      platformContainerId: 'container_123',
      token: 'page-token',
    });

    assert.equal(result.platformPostId, 'media_456');
    assert.equal(result.permalinkUrl, 'https://www.instagram.com/reel/example/');
    assert.equal(result.platformResponse.container_id, 'container_123');
    assert.equal(publishBody.creation_id, 'container_123');
  } finally {
    restoreAxios();
  }
});
