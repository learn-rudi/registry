/**
 * File download utilities
 */

import { writeFileSync, createWriteStream, unlinkSync } from 'fs';
import https from 'https';

export class DownloadError extends Error {
  constructor(message, statusCode = null) {
    super(message);
    this.name = 'DownloadError';
    this.statusCode = statusCode;
  }
}

export async function downloadFile(url, outputPath, options = {}) {
  const { apiKey, maxRedirects = 5 } = options;

  return new Promise((resolve, reject) => {
    let redirectCount = 0;

    const download = (downloadUrl) => {
      const urlWithAuth = apiKey && downloadUrl.includes('generativelanguage.googleapis.com')
        ? (downloadUrl.includes('?') ? `${downloadUrl}&key=${apiKey}` : `${downloadUrl}?key=${apiKey}`)
        : downloadUrl;

      https.get(urlWithAuth, (response) => {
        // Handle redirects
        if ([301, 302, 307, 308].includes(response.statusCode)) {
          if (++redirectCount > maxRedirects) {
            return reject(new DownloadError(`Too many redirects`, response.statusCode));
          }
          return download(response.headers.location);
        }

        if (response.statusCode !== 200) {
          return reject(new DownloadError(`HTTP ${response.statusCode}`, response.statusCode));
        }

        const fileStream = createWriteStream(outputPath);
        let sizeBytes = 0;

        response.on('data', chunk => sizeBytes += chunk.length);
        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve({
            path: outputPath,
            sizeBytes,
            sizeMB: (sizeBytes / 1024 / 1024).toFixed(2)
          });
        });

        fileStream.on('error', err => {
          unlinkSync(outputPath);
          reject(new DownloadError(`Write error: ${err.message}`));
        });

      }).on('error', err => reject(new DownloadError(`Network error: ${err.message}`)));
    };

    download(url);
  });
}

export async function saveBase64Image(base64Data, outputPath) {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    writeFileSync(outputPath, buffer);

    return {
      path: outputPath,
      sizeBytes: buffer.length,
      sizeMB: (buffer.length / 1024 / 1024).toFixed(2)
    };
  } catch (err) {
    throw new DownloadError(`Failed to save: ${err.message}`);
  }
}
