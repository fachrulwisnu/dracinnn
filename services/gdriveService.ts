import dotenv from 'dotenv';
dotenv.config();

import { google } from 'googleapis';
import axios from 'axios';

/**
 * Failsafe & Dynamic Drive Client Getter
 * Validates credentials just-in-time before any Google API call
 */
export const getDriveClient = () => {
  dotenv.config();

  const clientId = process.env.GDRIVE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN;
  const redirectUri = process.env.GDRIVE_REDIRECT_URI || 'https://developers.google.com/oauthplayground';

  if (!clientId || !refreshToken) {
    console.error('=== GDRIVE CREDENTIAL ERROR ===');
    console.error('Client ID:', clientId ? `PRESENT (${clientId.length} chars)` : 'MISSING');
    console.error('Client Secret:', clientSecret ? `PRESENT (${clientSecret.length} chars)` : 'MISSING');
    console.error('Refresh Token:', refreshToken ? `PRESENT (${refreshToken.length} chars)` : 'MISSING');
    console.error('===============================');
    throw new Error('FATAL: Kredensial GDrive (Client ID / Refresh Token) KOSONG dari environment variables!');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
};

/**
 * Searches for a folder by name under an optional parentId in Google Drive.
 * Creates it if it doesn't exist and returns its ID.
 */
export async function findOrCreateFolder(folderName: string, parentId?: string): Promise<string> {
  const drive = getDriveClient();
  try {
    let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(/'/g, "\\'")}' and trashed = false`;
    if (parentId) {
      query += ` and '${parentId}' in parents`;
    }

    const res = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (res.data.files && res.data.files.length > 0 && res.data.files[0].id) {
      return res.data.files[0].id;
    }

    // Create folder in Google Drive
    const fileMetadata: any = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
      fileMetadata.parents = [parentId];
    }

    const created = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id',
    });

    if (!created.data.id) {
      throw new Error(`Failed to create Google Drive folder: ${folderName}`);
    }

    return created.data.id;
  } catch (error: any) {
    console.error(`[GDrive] Error finding/creating folder "${folderName}":`, error.message);
    throw error;
  }
}

/**
 * Ensures folder hierarchy in Google Drive:
 * Uses GDRIVE_ROOT_FOLDER_ID if set, or finds/creates "Dracin Populer".
 * Then creates/finds subfolder: [Provider] - [dramaTitle].
 */
export async function getDramaFolder(provider: string, dramaTitle: string): Promise<string> {
  let rootFolderId = process.env.GDRIVE_ROOT_FOLDER_ID;
  
  if (!rootFolderId) {
    rootFolderId = await findOrCreateFolder('Dracin Populer');
  }

  const subFolderName = `${provider.toUpperCase()} - ${dramaTitle}`;
  const dramaFolderId = await findOrCreateFolder(subFolderName, rootFolderId);
  return dramaFolderId;
}

/**
 * Real Google Drive video uploader via Stream Piping.
 * Checks if the video file already exists in the parent folder before uploading.
 * Sets public permission ('anyone', 'reader') and returns Google Drive links.
 */
export async function uploadVideoFromUrl(
  videoUrl: string,
  fileName: string,
  folderId: string,
  forceResync = false
): Promise<{ fileId: string; webViewLink: string; gdriveDirectLink: string; directLink: string }> {
  const drive = getDriveClient();

  // 1. Check if file already exists in Google Drive folder (unless forceResync is requested)
  if (!forceResync) {
    try {
      const existingQuery = `mimeType != 'application/vnd.google-apps.folder' and name = '${fileName.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`;
      const existingRes = await drive.files.list({
        q: existingQuery,
        fields: 'files(id, name, webViewLink, webContentLink)',
        spaces: 'drive',
      });

      if (existingRes.data.files && existingRes.data.files.length > 0) {
        const existingFile = existingRes.data.files[0];
        const existingId = existingFile.id!;
        const webViewLink = existingFile.webViewLink || `https://drive.google.com/file/d/${existingId}/view`;
        const directLink = existingFile.webContentLink || `https://drive.google.com/uc?export=download&id=${existingId}`;

        console.log(`[GDrive] File "${fileName}" already exists in Drive (ID: ${existingId}). Skipping re-upload.`);

        return {
          fileId: existingId,
          webViewLink,
          gdriveDirectLink: directLink,
          directLink,
        };
      }
    } catch (checkErr: any) {
      console.warn(`[GDrive] Warning checking existing file status for ${fileName}:`, checkErr.message);
    }
  } else {
    console.log(`[GDrive] Force Resync requested for "${fileName}". Bypassing cache to download and re-upload.`);
  }

  // 2. Ekstrak URL asli CDN jika menggunakan proxy decrypt-stream / proxy Sansekai
  let targetDownloadUrl = videoUrl;
  if (videoUrl.includes('decrypt-stream') || videoUrl.includes('/proxy') || videoUrl.includes('url=')) {
    try {
      const urlObj = new URL(videoUrl);
      const extractedUrl = urlObj.searchParams.get('url');
      if (extractedUrl) {
        targetDownloadUrl = extractedUrl;
        console.log(`[GDrive] Ekstrak Direct CDN URL untuk bypass Cloudflare: ${targetDownloadUrl.substring(0, 70)}...`);
      }
    } catch (e) {
      console.warn("[GDrive] Gagal mengekstrak URL CDN, mencoba URL original.");
    }
  }

  // 3. Download stream LANGSUNG dari CDN Melolo/TikTok dengan Header Spoofing
  console.log(`[GDrive] Downloading video stream directly from: ${targetDownloadUrl.substring(0, 80)}...`);
  const response = await axios({
    method: 'get',
    url: targetDownloadUrl,
    responseType: 'stream',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      Connection: 'keep-alive',
      // Kosongkan Referer agar tidak dicurigai CDN
      Referer: '',
    },
    timeout: 180000,
    maxRedirects: 5,
  });

  // 4. Stream Pipe directly into Google Drive API file creation
  console.log(`[GDrive] Piping video stream directly into Google Drive as "${fileName}"...`);
  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };
  const media = {
    mimeType: 'video/mp4',
    body: response.data,
  };

  const driveFile = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, webViewLink, webContentLink',
  });

  const fileId = driveFile.data.id;
  if (!fileId) {
    throw new Error('Failed to obtain file ID from Google Drive upload response.');
  }

  // 5. Set permissions to public (anyone with link can view/download)
  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
  } catch (permErr: any) {
    console.warn('[GDrive] Permission setting warning:', permErr.message);
  }

  const webViewLink = driveFile.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
  const gdriveDirectLink = driveFile.data.webContentLink || `https://drive.google.com/uc?export=download&id=${fileId}`;

  console.log(`[GDrive] Successfully uploaded "${fileName}" to Google Drive (ID: ${fileId})`);

  return {
    fileId,
    webViewLink,
    gdriveDirectLink,
    directLink: gdriveDirectLink,
  };
}
