import installExtension, { REACT_DEVELOPER_TOOLS } from "electron-devtools-installer";
import * as E from "electron";
import * as url from "url";

import Tabs from "./Tabs";
import initMainMenu, { toggleMenu } from "./menu";
import ActionState from "../ActionState";
import * as Const from "Const";
import {
    isDev,
    winUrlDev,
    winUrlProd,
    isFileBrowser
} from "Utils";

interface IWindowManager {
    home: string;
    mainWindow: E.BrowserWindow;
    scale: number;

    getZoom(): Promise<number>;
    setZoom(zoom: number): void;
    openUrl(url: string): void;
    addTab(scriptPreload: string, url: string): E.BrowserView;
    reloadAllWindows(): void;
}

class WindowManager implements IWindowManager {
    home: string;
    mainWindow: E.BrowserWindow;
    scale: number;
    closedTabsHistory: Array<string> = [];
    private static _instance: WindowManager;
    private panelHeight: number = Const.TOPPANELHEIGHT;

    private constructor(options: E.BrowserWindowConstructorOptions, home: string) {
        this.home = home;
        this.scale = 1;

        this.mainWindow = new E.BrowserWindow(options);
        this.mainWindow.loadURL(isDev ? winUrlDev : winUrlProd);

        initMainMenu();
        this.addTab('loadMainContetnt.js');

        this.mainWindow.on('resize', this.updateBounds);
        this.mainWindow.on('maximize', (e: Event) => setTimeout(() => this.updateBounds(e), 100));
        this.mainWindow.on('unmaximize', (e: Event) => setTimeout(() => this.updateBounds(e), 100));
        this.mainWindow.on('move', (e: Event) => setTimeout(() => this.updateBounds(e), 100));

        isDev && this.installReactDevTools();
        isDev && this.mainWindow.webContents.openDevTools({ mode: 'detach' });

        this.addIpc();
    }

    static get instance(): WindowManager {
        if (WindowManager._instance) {
            return WindowManager._instance;
        }

        const options: E.BrowserWindowConstructorOptions = {
            width: 1200,
            height: 900,
            frame: true,
            webPreferences: {
                zoomFactor: 1,
                nodeIntegration: true,
                nodeIntegrationInWorker: false,
                webviewTag: false,
                webSecurity: false,
                webgl: true,
                experimentalFeatures: true
            }
        };

        const home = Const.HOMEPAGE;

        WindowManager._instance = new WindowManager(options, home);

        return WindowManager._instance;
    }

    reloadAllWindows = () => {}

    getZoom = (): Promise<number> => new Promise((resolve) => {
        this.mainWindow.webContents.getZoomFactor(z => resolve(z));
    });

    setZoom = (zoom: number) => {
        const tabs = Tabs.getAll();

        this.mainWindow.webContents.setZoomFactor(zoom);

        tabs.forEach(t => t.webContents.setZoomFactor(zoom));
    };

    openUrl = (url: string) => {
        if (/figma:\/\//.test(url)) {
            this.addTab('loadContetnt.js', url.replace(/figma:\//, Const.HOMEPAGE));
        } else if (/https?:\/\//.test(url)) {
            this.addTab('loadContetnt.js', url);
        }
    }


    private addIpc = () => {
        E.ipcMain.on(Const.NEWTAB, async () => this.addTab());

        E.ipcMain.on(Const.CLOSETAB, (event: Event, id: number) => {
            this.closeTab(id);
        });

        E.ipcMain.on(Const.FOCUSTAB, (event: Event, id: number) => {
            const view = Tabs.focus(id);
            this.mainWindow.setBrowserView(view);

            if (isFileBrowser(view.webContents.getURL())) {
                ActionState.updateInFileBrowserActionState();
            } else {
                ActionState.updateInProjectActionState();
            }
        });

        E.ipcMain.on(Const.MAINTAB, (event: Event) => {
            const view = Tabs.focus(1);
            this.mainWindow.setBrowserView(view);

            if (isFileBrowser(view.webContents.getURL())) {
                ActionState.updateInFileBrowserActionState();
            } else {
                ActionState.updateInProjectActionState();
            }
        });

        E.ipcMain.on(Const.CLOSEALLTAB, () => {
            console.log('Close all tab');
        });

        E.ipcMain.on(Const.SETTITLE, (event: Event, title: string) => {
            this.mainWindow.webContents.send(Const.SETTITLE, { id: this.mainWindow.getBrowserView()!.id, title })
        });

        E.ipcMain.on(Const.UPDATEFILEKEY, (event: Event, key: string) => {
            this.mainWindow.webContents.send(Const.UPDATEFILEKEY, { id: this.mainWindow.getBrowserView()!.id, fileKey: key })
        });

        E.ipcMain.on(Const.UPDATEACTIONSTATE, (event: Event, state: Object) => {
            ActionState.updateActionState(state);
        });

        E.ipcMain.on(Const.TOHOME, (event: Event, title: string) => {
            this.openFileBrowser();
        });

        E.app.on('handleCommand', (id: string) => {
            console.log('handleCommand id: ', id);
            switch(id) {
                case 'scale-normal': {
                    this.scale = 1;
                    this.updateScale(this.scale);
                } break;
                case 'scale-inc0.1': {
                    this.scale += 0.1;
                    this.updateScale(this.scale);
                } break;
                case 'scale-dic0.1': {
                    this.scale -= 0.1;
                    this.updateScale(this.scale);
                } break;
                case 'scale-inc0.05': {
                    this.scale += 0.05;
                    this.updateScale(this.scale);
                } break;
                case 'scale-dic0.05': {
                    this.scale -= 0.05;
                    this.updateScale(this.scale);
                } break;
                case 'openFileBrowser': {
                    this.openFileBrowser();
                } break;
                case 'reopenClosedTab': {
                    if (this.closedTabsHistory.length <= 0) return;

                    const url = this.closedTabsHistory.pop();
                    const script = /files\/recent$/.test(url) ? 'loadMainContetnt.js' : 'loadContetnt.js';

                    this.addTab(script, url);
                } break;
                case 'closeTab': {
                    const currentView = this.mainWindow.getBrowserView();

                    if (currentView.id === 1) return;

                    this.mainWindow.webContents.send(Const.CLOSETAB, { id: currentView.id });
                    this.closeTab(currentView.id);
                } break;
                case 'toggle-menu': {
                    toggleMenu();

                    ActionState.updateActionState();
                } break;
                case 'newFile': {
                    const currentView = this.addTab();
                    const onDidFinishLoad = () => {
                        currentView.webContents.send('newFile');
                        currentView.webContents.removeListener('did-finish-load', onDidFinishLoad);
                    }

                    currentView.webContents.on('did-finish-load', onDidFinishLoad);
                } break;
            }
        })
    }

    public addTab = (scriptPreload: string = 'loadMainContetnt.js', url: string = `${this.home}/login`): E.BrowserView => {
        const tab = Tabs.newTab(url, this.getBounds(), scriptPreload);

        this.mainWindow.setBrowserView(tab);
        tab.webContents.on('will-navigate', this.onMainWindowWillNavigate);
        tab.webContents.on('new-window', this.onNewWindow);

        if (isFileBrowser) {
            ActionState.updateInFileBrowserActionState();
        } else {
            ActionState.updateActionState(Const.ACTIONTABSTATE);
        }

        this.mainWindow.webContents.send(Const.TABADDED, { id: tab.id, url: `${this.home}/login`, showBackBtn: true});

        return tab;
    }

    public logoutAndRestart = (event?: E.Event) => {
        E.net.request(`${this.home}/logout`).on('response', response => {
            response.on('data', data => {});
            response.on('error', (err: Error) => {
                console.log('Request error: ', err);
            });
            response.on('end', () => {
                if (response.statusCode >= 200 && response.statusCode <= 299) {

                    E.session.defaultSession!.cookies.flushStore(() => {
                        const view = Tabs.focus(1);
                        this.mainWindow.setBrowserView(view);
                        view.webContents.reload();

                        Tabs.closeAll();

                        this.mainWindow.webContents.send(Const.CLOSEALLTAB);
                    });
                }

                if (response.statusCode >= 400) {
                    E.session.defaultSession!.clearStorageData();
                    this.mainWindow.webContents.loadURL(`${this.home}`);
                }
            });
        }).end();

        event && event.preventDefault();
        return;
    }

    private onNewWindow = (event: Event, url: string) => {
        let view;

        if (/start_google_sso/.test(url)) return;

        view = Tabs.newTab(`${url}`, this.getBounds(), 'loadContetnt.js');

        view.webContents.on('will-navigate', this.onMainWindowWillNavigate);

        this.mainWindow.setBrowserView(view);
        this.mainWindow.webContents.send(Const.TABADDED, { id: view.id, url, showBackBtn: false});
    }

    private onMainWindowWillNavigate = (event: E.Event, newUrl: string) => {
        const currentUrl = event.sender.getURL();

        if (newUrl === currentUrl) {
            event.preventDefault();
            return;
        }

        const from = url.parse(currentUrl);
        const to = url.parse(newUrl);

        if (from.pathname === '/login') {
            Tabs.reloadAll();

            event.preventDefault();
            return;
        }

        if (to.pathname === '/logout') {
            this.logoutAndRestart(event);
        }
    }

    private openFileBrowser = () => {
        const currentView = this.mainWindow.getBrowserView();
        const currentUrl = currentView && currentView.webContents.getURL() || '';
        const go: boolean = url.parse(currentUrl).pathname !== '/files/recent';

        ActionState.updateActionState(Const.INITACTIONINITSTATE);

        currentView && go && currentView!.webContents.loadURL(`${this.home}`);
    }

    private closeTab = (id: number) => {
        const views = Tabs.getAll();
        const currentView = this.mainWindow.getBrowserView();
        const index: number = views.findIndex(t => t.id == id);
        const view = Tabs.focus(views[index > 0 ? index-1 : index].id);
        this.mainWindow.setBrowserView(view);

        this.closedTabsHistory.push(currentView.webContents.getURL());

        Tabs.close(id);
    }

    private updateScale = (scale: number) => {
        const views = Tabs.getAll();

        this.mainWindow.webContents.setZoomFactor(scale);
        this.panelHeight = Math.floor(Const.TOPPANELHEIGHT * scale);

        this.updateBounds();

        for (let view of views) {
            view.webContents.setZoomFactor(scale);
        }
    }

    private getBounds = () => {
        return {
            x: 0,
            y: this.panelHeight,
            width: this.mainWindow.getContentBounds().width,
            height: this.mainWindow.getContentBounds().height - this.panelHeight
        };
    }

    private updateBounds = (event?: Event) => {
        const views = Tabs.getAll();

        views.forEach((bw: E.BrowserView) => {
            bw.setBounds(this.getBounds());
        })
    }

    private installReactDevTools = () => {
		installExtension(REACT_DEVELOPER_TOOLS)
			.then((name: string) => console.log(`Added Extension:  ${name}`))
			.catch((err: Error) => console.log('An error occurred: ', err));
    }
}

export default WindowManager;
export {
    IWindowManager
}
