const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getServer: () => ipcRenderer.invoke('get-server'),
    setServer: (serverId) => ipcRenderer.invoke('set-server', serverId),
    onServerChanged: (callback) => {
        const subscription = (_event, serverId) => callback(serverId);
        ipcRenderer.on('server-changed', subscription);
        return () => ipcRenderer.removeListener('server-changed', subscription);
    },
});
