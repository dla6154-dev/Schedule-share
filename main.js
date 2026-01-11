const { app, BrowserWindow, screen, Menu, ipcMain, Notification } = require('electron'); 
const path = require('path');
const fs = require('fs-extra'); // 설정 파일 처리를 위해 사용

// 설정 파일 경로 정의
const USER_DATA_PATH = app.getPath('userData');
const SERVER_SETTINGS_PATH = path.join(USER_DATA_PATH, 'server_settings.json'); // 마지막 사용 ID 저장
const TEAM_LIST_PATH = path.join(USER_DATA_PATH, 'team_list.json'); // 팀 목록 저장

// 기본 팀 목록 (설정 파일이 없을 경우 사용)
const INITIAL_TEAM_SERVERS = [
    { label: '팀 A (기본 서버)', appId: 'team-a-default' },
    { label: '팀 B (마케팅팀)', appId: 'team-b-marketing' },
    { label: '팀 C (개발팀)', appId: 'team-c-dev' },
    { label: '팀 D (영업팀)', appId: 'team-d-sales' },
];

let TEAM_SERVERS = []; // 로드된 팀 목록을 저장할 변수
let DEFAULT_APP_ID = INITIAL_TEAM_SERVERS[0].appId; // 초기 기본 ID
let CURRENT_APP_ID = DEFAULT_APP_ID; // 현재 선택된 서버 ID (라디오 표시용)


// ===============================================================
// 0.1 서버 목록 및 ID 저장/로드 헬퍼 함수
// ===============================================================

// 팀 목록 로드 (앱 시작 시 호출)
async function loadTeamList() {
    try {
        if (await fs.pathExists(TEAM_LIST_PATH)) {
            TEAM_SERVERS = await fs.readJson(TEAM_LIST_PATH);
        } else {
            // 파일이 없으면 기본 목록을 사용하고 저장
            TEAM_SERVERS = INITIAL_TEAM_SERVERS;
            await fs.writeJson(TEAM_LIST_PATH, TEAM_SERVERS, { spaces: 2 });
        }
    } catch (e) {
        console.error('팀 목록 로드 중 오류 발생:', e);
        TEAM_SERVERS = INITIAL_TEAM_SERVERS; // 오류 시 기본값 사용
    }
}

// 마지막 사용 서버 ID 로드
async function loadLastServerId() {
    try {
        if (await fs.pathExists(SERVER_SETTINGS_PATH)) {
            const settings = await fs.readJson(SERVER_SETTINGS_PATH);
            if (settings && settings.lastAppId) {
                // 마지막으로 사용한 ID가 현재 팀 목록에 있는지 확인
                const isValidId = TEAM_SERVERS.some(team => team.appId === settings.lastAppId);
                if (isValidId) {
                    DEFAULT_APP_ID = settings.lastAppId; 
                }
            }
        }
    } catch (e) {
        console.error('설정 파일 로드 중 오류 발생:', e);
    }
    return DEFAULT_APP_ID;
}

// 서버 ID 저장
async function saveServerId(appId) {
    try {
        await fs.writeJson(SERVER_SETTINGS_PATH, { lastAppId: appId });
        console.log(`서버 ID 저장됨: ${appId}`);
    } catch (e) {
        console.error('설정 파일 저장 중 오류 발생:', e);
    }
}

// ===============================================================
// 0.2 자동 시작 상태 확인 함수 (메뉴 체크박스용)
// ===============================================================
function getAutoStartStatus() {
    if (app.isPackaged) {
        return app.getLoginItemSettings().openAtLogin;
    }
    return false; 
}


// ===============================================================
// 0.3 서버 목록 편집기 창 생성 (새 파일 로드)
// ===============================================================

function createServerEditorWindow() {
    let editorWindow = new BrowserWindow({
        width: 700,
        height: 600,
        title: '서버 목록 편집',
        webPreferences: {
            nodeIntegration: true, 
            contextIsolation: false, 
        }
    });
    
    // server_editor.html 파일을 로드합니다.
    editorWindow.loadFile(path.join(__dirname, 'server_editor.html'));

    editorWindow.setMenuBarVisibility(false);
}

// IPC 리스너 설정 (편집기 창과 통신 및 알림 처리)
function setupIpcListeners() {
    ipcMain.on('request-team-list', (event) => {
        // 현재 로드된 팀 목록을 편집기 창으로 보냅니다.
        event.reply('response-team-list', TEAM_SERVERS);
    });

    ipcMain.on('save-team-list', async (event, newTeamList) => {
        try {
            // 팀 목록 파일에 저장
            await fs.writeJson(TEAM_LIST_PATH, newTeamList, { spaces: 2 });
            
            // 성공 메시지 전송 및 편집기 창 닫기
            event.reply('save-success-close');
            
            // 앱 재시작 (새로운 설정으로 메뉴를 다시 구성하기 위해)
            app.relaunch();
            app.exit(0);

        } catch (e) {
            console.error('팀 목록 저장 중 오류 발생:', e);
        }
    });
    
    // 알림 요청 리스너
    ipcMain.on('show-notification', (event, { title, body }) => {
        if (Notification.isSupported()) {
            new Notification({
                title: title,
                body: body,
                silent: false, // 소리 있음
            }).show();
        }
    });
}


// ===============================================================
// 0. 메뉴 바 정의 (Server, View 등 표준 메뉴)
// ===============================================================

function createApplicationMenu(currentAppId) {
    const isMac = process.platform === 'darwin';

    // [Server] 메뉴 템플릿 생성
    const serverMenu = {
        label: '서버 (Server)',
        submenu: TEAM_SERVERS.map(server => ({
            label: server.label,
            type: 'radio',
            // 현재 로드된 ID와 일치하는지 확인
            checked: server.appId === currentAppId, 
            click: () => {
                const focusedWindow = BrowserWindow.getFocusedWindow();
                CURRENT_APP_ID = server.appId;
                if (focusedWindow) {
                    // IPC 통신으로 renderer에 새 App ID 전달 (서버 전환 명령)
                    focusedWindow.webContents.send('set-server-id', server.appId);
                    // [추가] 서버 전환 시 ID를 영구적으로 저장
                    saveServerId(server.appId); 
                }
                // 메뉴 라디오 상태를 즉시 반영
                createApplicationMenu(CURRENT_APP_ID);
                Menu.sendActionToFirstResponder('hide');
            }
        }))
    };
    
    const template = [
        // (Mac 메뉴는 생략)
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about', label: '업무 공유 플랫폼 정보' },
                { type: 'separator' },
                { role: 'quit', label: '앱 종료' }
            ]
        }] : []),
        
        // [Server] 메뉴 추가 (Edit 대신)
        serverMenu,

        // [View] 메뉴 (개발자 도구 등)
        {
            label: '보기 (View)',
            submenu: [
                { role: 'reload', label: '새로고침' },
                { type: 'separator' },
                {
                    label: '개발자 도구 (Dev Tools)',
                    accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
                    click(item, focusedWindow) {
                        if (focusedWindow) focusedWindow.webContents.toggleDevTools();
                    }
                }
            ]
        },
        // [Help] 메뉴 추가
        { role: 'help', submenu: [{ label: 'Electron 정보' }] }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}


// ===============================================================
// 1. 자동 실행 설정 함수
// ===============================================================

function setAutoStart() {
    const isDevelopment = process.env.NODE_ENV !== 'production';

    if (!isDevelopment) {
        const appName = app.getName(); 
        app.setLoginItemSettings({
            openAtLogin: true, 
            path: process.execPath, 
            args: [], 
        });
        console.log(`${appName}의 자동 실행 설정 완료.`);
    }
}

// ===============================================================
// 2. 메인 창 생성 함수 (일반 창 스타일 및 IPC 활성화)
// ===============================================================

function createWindow(initialAppId) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    const WIDGET_WIDTH = 450;
    const WIDGET_HEIGHT = 650;
    
    const xPos = width - WIDGET_WIDTH - 20; 
    const yPos = 20; 

    const SHOW_SYSTEM_FRAME = false; 

    const mainWindow = new BrowserWindow({
        width: WIDGET_WIDTH, 
        height: WIDGET_HEIGHT, 
        minWidth: 350,
        minHeight: 500,
        x: xPos, 
        y: yPos, 
        title: '업무 공유 플랫폼',
        
        // 창 고정 기능 제거
        frame: SHOW_SYSTEM_FRAME, 
        transparent: false, 
        resizable: true, 
        alwaysOnTop: false, 

        webPreferences: {
            nodeIntegration: true, 
            contextIsolation: false, 
        }
    });

    // ready-to-show 이벤트
    mainWindow.on('ready-to-show', () => {
        mainWindow.show();
        // 렌더러에게 초기 서버 ID를 전달하여 데이터 로드를 시작
        mainWindow.webContents.send('set-server-id', initialAppId); 
    });


    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.webContents.setWindowOpenHandler(() => ({
        action: 'allow',
        overrideBrowserWindowOptions: {
            width: 920,
            height: 680,
            resizable: true,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            }
        }
    }));

    mainWindow.webContents.on('did-create-window', (childWindow) => {
        childWindow.setMenu(null);
        childWindow.setMenuBarVisibility(false);
        childWindow.setAutoHideMenuBar(true);
    });
    
    // 3. 우클릭 메뉴 (Context Menu) 추가
    const buildServerSwitchMenu = () => TEAM_SERVERS.map(server => ({
        label: server.label,
        type: 'radio',
        checked: server.appId === CURRENT_APP_ID, 
        click: () => {
            CURRENT_APP_ID = server.appId;
            mainWindow.webContents.send('set-server-id', server.appId);
            saveServerId(server.appId); 
            createApplicationMenu(CURRENT_APP_ID);
        }
    }));

    mainWindow.webContents.on('context-menu', (event, params) => {
        const currentMenu = Menu.buildFromTemplate([
            { label: '--- 서버 전환 ---', enabled: false }, 
            ...buildServerSwitchMenu(),
            { type: 'separator' },
            
            { label: '서버 목록 편집 (Edit)', click: createServerEditorWindow }, 
            { type: 'separator' },

            { label: '--- 설정 ---', enabled: false },
            { 
                label: '시작 프로그램에 등록',
                type: 'checkbox',
                checked: getAutoStartStatus(),
                click: (menuItem) => {
                    const newSetting = menuItem.checked;
                    app.setLoginItemSettings({ openAtLogin: newSetting });
                    console.log(`시작 프로그램 등록 상태: ${newSetting}`);
                }
            },
            { type: 'separator' },
            
            { label: '새로고침 (Reload)', role: 'reload' },
            { label: '개발자 도구 (Dev Tools)', role: 'toggleDevTools' },
            { type: 'separator' },
            { label: '앱 종료 (Quit)', role: 'quit' }
        ]);
        currentMenu.popup(mainWindow, params.x, params.y);
    });
}

// ===============================================================
// 3. 앱 라이프사이클 (시동 걸기)
// ===============================================================

// Electron 앱이 시작할 준비가 되면 실행합니다.
app.whenReady().then(async () => {
    // Windows에서 토스트 알림을 정상적으로 띄우려면 AppUserModelId 설정이 필요합니다.
    if (process.platform === 'win32') {
        app.setAppUserModelId(app.getName());
    }

    // IPC 리스너를 먼저 설정합니다.
    setupIpcListeners(); 
    
    // 팀 목록과 마지막 사용 서버 ID를 로드합니다.
    await loadTeamList();
    const initialAppId = await loadLastServerId(); 
    CURRENT_APP_ID = initialAppId;
    
    // 앱의 메뉴(Alt 키로 접근하는 메뉴바)를 설정
    createApplicationMenu(initialAppId); 
    
    // 메인 창 생성
    createWindow(initialAppId); 
    
    // 자동 실행 설정 (앱 설치 시 최초 1회만 실행되도록 main.js에 구현되어 있음)
    setAutoStart(); 
});

// 모든 창이 닫히면 앱을 종료합니다. (macOS 제외)
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit(); // macOS가 아니면 종료
});
