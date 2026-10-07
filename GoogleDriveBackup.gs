/**
 * Google Apps Script bridge สำหรับ QR Score Studio v32
 * 1) เปิด script.google.com > New project
 * 2) วางโค้ดนี้ใน Code.gs
 * 3) Deploy > New deployment > Web app
 *    Execute as: Me
 *    Who has access: Anyone
 * 4) นำ Web app URL ไปใส่ GOOGLE_DRIVE_BACKUP_URL ใน config.js
 */
const BACKUP_FOLDER_NAME = 'Kru Dew QR Score Studio Backup';

function doGet() {
  return ContentService.createTextOutput('QR Score Studio Backup API is ready.');
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!body.backup) throw new Error('Missing backup payload');

    const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
    const filename = sanitizeFileName_(body.filename || ('QR_Score_Studio_Backup_' + new Date().toISOString() + '.json'));
    const blob = Utilities.newBlob(JSON.stringify(body.backup, null, 2), 'application/json', filename);
    const file = folder.createFile(blob);

    return ContentService.createTextOutput(JSON.stringify({ok:true,fileId:file.getId(),name:file.getName()}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(err && err.message || err)}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function sanitizeFileName_(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_');
}
