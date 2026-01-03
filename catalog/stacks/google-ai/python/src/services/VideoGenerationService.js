/**
 * Video Generation Service
 * Orchestrates video generation with progress tracking and queue management
 */

import { VeoVideoClient } from '../clients/VeoVideoClient.js';

export class VideoGenerationService {
  constructor(apiKey) {
    this.client = new VeoVideoClient(apiKey);
    this.queue = [];
    this.isProcessing = false;
  }

  /**
   * Generate single video
   */
  async generateVideo(model, prompt, options = {}) {
    return this.client.generateVideo(model.id, prompt, options);
  }

  /**
   * Generate with detailed progress tracking
   */
  async generateWithProgress(model, prompt, options = {}) {
    const { onProgress, onComplete } = options;

    const progressCallback = (status) => {
      if (onProgress) {
        onProgress({
          ...status,
          stage: status.progress < 100 ? 'generating' : 'complete'
        });
      }
    };

    try {
      const result = await this.client.generateVideo(model.id, prompt, {
        ...options,
        onProgress: progressCallback
      });

      if (onComplete) {
        onComplete({ success: true, result });
      }

      return result;
    } catch (err) {
      if (onComplete) {
        onComplete({ success: false, error: err.message });
      }
      throw err;
    }
  }

  /**
   * Add video to generation queue
   */
  async queueVideo(model, prompt, options = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        model,
        prompt,
        options,
        resolve,
        reject
      });

      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process video generation queue
   */
  async processQueue() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const job = this.queue.shift();

    try {
      const result = await this.generateVideo(job.model, job.prompt, job.options);
      job.resolve(result);
    } catch (err) {
      job.reject(err);
    }

    // Process next in queue
    await this.processQueue();
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return {
      queued: this.queue.length,
      processing: this.isProcessing
    };
  }
}
