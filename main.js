const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { saveBlogPostAsPDF } = require('./makepdf');
const { searchBlogs } = require('./crawler');
const { processBlogResults } = require('./batchpdf');
const fs = require('fs');

// Gemini API Key 저장 경로
const apiKeyPath = path.join(app.getPath('userData'), 'gemini-api-key.txt');

ipcMain.handle('get-saved-api-key', async () => {
     try {
          if (fs.existsSync(apiKeyPath)) {
               return fs.readFileSync(apiKeyPath, 'utf-8');
          }
     } catch (e) {
          console.error('Gemini API Key 로드 실패:', e.message);
     }
     return '';
});

// 콘솔 출력을 가로채서 GUI로 전송하기 위한 설정
function setupConsoleProxy(win) {
     const originalConsole = {
          log: console.log,
          error: console.error,
          warn: console.warn,
          info: console.info,
     };

     function proxyConsole(type) {
          return function (...args) {
               originalConsole[type].apply(console, args);
               const message = args
                    .map((arg) => {
                         if (typeof arg === 'object') {
                              return JSON.stringify(arg);
                         }
                         return String(arg);
                    })
                    .join(' ');

               if (win && !win.isDestroyed()) {
                    win.webContents.send('console-message', { type, message });
               }
          };
     }

     console.log = proxyConsole('log');
     console.error = proxyConsole('error');
     console.warn = proxyConsole('warn');
     console.info = proxyConsole('info');
}

function createWindow() {
     const win = new BrowserWindow({
          width: 1000,
          height: 800,
          webPreferences: {
               nodeIntegration: true,
               contextIsolation: false,
          },
     });
     win.loadFile('index.html');
     setupConsoleProxy(win);
}

app.whenReady().then(() => {
     createWindow();

     app.on('activate', () => {
          if (BrowserWindow.getAllWindows().length === 0) {
               createWindow();
          }
     });
});

app.on('window-all-closed', () => {
     if (process.platform !== 'darwin') {
          app.quit();
     }
});

// 검색 상태 업데이트 함수
function updateStatus(event, message, type = 'info') {
     event.reply('status-update', { message, type });
}

// Gemini API Key 저장
ipcMain.on('save-api-key', (event, apiKey) => {
     try {
          fs.writeFileSync(apiKeyPath, apiKey, 'utf-8');
     } catch (e) {
          console.error('Gemini API Key 저장 실패:', e.message);
     }
});

// 저장된 Gemini API Key 가져오기
function getSavedApiKey() {
     try {
          if (fs.existsSync(apiKeyPath)) {
               return fs.readFileSync(apiKeyPath, 'utf-8');
          }
     } catch (e) {
          console.error('Gemini API Key 로드 실패:', e.message);
     }
     return '';
}

// 검색 요청 처리
ipcMain.on(
     'start-search',
     async (event, { keyword, startDate, endDate, apiKey }) => {
          try {
               // 검색 시작 알림
               updateStatus(event, '블로그 검색을 시작합니다...', 'info');

               // 블로그 검색 실행 및 실제 json 경로 반환
               const resultFile = await searchBlogs(
                    keyword,
                    startDate,
                    endDate
               );
               updateStatus(
                    event,
                    '블로그 검색이 완료되었습니다. PDF 생성을 시작합니다...',
                    'info'
               );

               // PDF 생성 실행
               await processBlogResults(
                    keyword,
                    resultFile,
                    apiKey || getSavedApiKey()
               );

               updateStatus(event, 'PDF 생성이 완료되었습니다!', 'success');
               event.reply('search-complete', {
                    success: true,
                    message: 'PDF 생성이 완료되었습니다.',
               });
          } catch (error) {
               console.error('Error:', error);
               updateStatus(
                    event,
                    `오류가 발생했습니다: ${error.message}`,
                    'error'
               );
               event.reply('search-complete', {
                    success: false,
                    error: error.message,
               });
          }
     }
);

// (index.html에서 get-saved-conditions 관련 ipcRenderer.invoke 호출 제거 필요)
