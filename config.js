// เปลี่ยนชื่อไฟล์นี้เป็น config.js แล้วใส่ค่าจาก Supabase Project Settings > API
window.APP_CONFIG = {
  SUPABASE_URL: "https://tublfwatlbfblxmwvdej.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_GW0g9KctJ8ODrgg2KhlmdQ_BT-XCFJE",
  // ใช้เป็นรายชื่อห้องเริ่มต้นครั้งแรก หลังจากนั้นจัดการห้องผ่านหน้าเว็บได้
  ROOMS: ["4/2", "4/4", "4/6", "4/8", "4/10", "5/1", "5/2", "6/6", "6/7"],
  // URL จาก Google Apps Script Web App สำหรับสำรองข้อมูลไป Google Drive
  GOOGLE_DRIVE_BACKUP_URL: "https://script.google.com/macros/s/AKfycbxwlrsBdUOOemeVkN7Ma5kR_AqzHs3-7gekEs6-O_VT1_XQJkDdtBhh7eHXgqYi2mK0/exec"
};
