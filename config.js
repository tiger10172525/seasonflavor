// ============================================
// 肆菓 Season Flavor — 前端設定
// ============================================
//
// orderEndpoint：Google Apps Script 佈署後的 Web App /exec 網址。
//   佈署步驟見 README.md（apps-script/Code.gs）。
//   在填入網址之前，網站會以「示範模式」運作：仍可操作訂購流程，
//   送出時改用信箱草稿（mailto）作為備援，並在畫面提示尚未啟用線上收單。
//
// ownerEmail：示範模式的 mailto 備援收件信箱（實際上線後由後端寄送，
//   這裡只是後備方案）。
window.SF_CONFIG = {
  orderEndpoint: '',
  ownerEmail: 'seasonflavor.order@gmail.com'
};
