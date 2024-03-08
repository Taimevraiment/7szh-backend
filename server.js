import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { GeniusInvokationGame } from "./geniusinvokation.js";

const app = express();

const httpServer = createServer(app);
const PORT = 7000;
const io = new Server(httpServer, {
    cors: {
        origin: [
            'http://127.0.0.1:5500',
            'http://taim.site',
            'http://7szh.taim.site',
            'http://localhost:5500',
        ],
        methods: ['GET', 'POST']
    }
});

const playerList = []; // 在线玩家列表
const roomList = []; // 创建房间列表
const removePlayerList = new Map(); // 玩家即将离线销毁列表
// 生成id
const genId = (arr = [], option = {}) => {
    const { len = 4, prefix } = option;
    let id;
    while (id == undefined || arr.findIndex(v => v?.id == id) > -1) {
        id = Math.floor(Math.random() * (prefix ? 1 : 9) * 10 ** (len - 1) + (prefix || 1) * 10 ** (len - 1));
    }
    return id;
}
// 按id获取
const getById = (id, list) => list.find(v => v.id == id);
// 按id获取idx
const getIdxById = (id, list) => list.findIndex(v => v.id == id);
// 按id去除
const removeById = (id, list) => list.splice(getIdxById(id, list), 1);

// 获取玩家信息
const getPlayer = pid => getById(pid, playerList);
// 获取玩家索引
const getPlayerIdx = pid => getIdxById(pid, playerList);
// 获取房间信息
const getRoom = rid => getById(rid, roomList);
// 获取房间索引
const getRoomIdx = rid => getIdxById(rid, roomList);
// 发送房间列表
const emitRoomList = () => {
    io.emit('getRoomList', {
        rlist: roomList.map(r => ({
            id: r.id,
            name: r.name,
            isStart: r.isStart,
            playerCnt: r.players.length,
            hasPassWord: r.password != '',
        })),
    });
}
// 玩家离线销毁
const removePlayer = pid => {
    const time = setTimeout(() => {
        removeById(pid, playerList);
    }, 60 * 60 * 1000);
    removePlayerList.set(pid, {
        time,
        cancel: () => {
            clearTimeout(removePlayerList.get(pid).time);
            removePlayerList.delete(pid);
        }
    });
}
// 更新房间信息
const roomInfoUpdate = roomId => {
    const room = getRoom(roomId);
    if (!room) throw new Error(`房间${roomId}不存在`);
    io.to(`7szh-${room.id}`).emit('roomInfoUpdate', {
        players: room.players,
        isStart: room.isStart,
        phase: room.phase,
    });
}

io.on('connection', socket => {
    let pid = -1;
    // 发送玩家列表
    const emitPlayerList = () => {
        io.emit('getPlayerList', {
            plist: playerList.map(p => ({
                id: p.id,
                name: p.name,
                rid: p.rid ?? -1,
            })).filter(p => !removePlayerList.has(p.id)),
        });
    }
    // 离开房间
    const leaveRoom = eventName => {
        if (pid == -1) return;
        const me = getPlayer(pid);
        if (!me) throw new Error(`${eventName}:未找到玩家,me:${JSON.stringify(me)}`);
        const log = eventName == 'exitRoom' ? `[${new Date()}]:玩家[${me.name}]离开了房间[${me.rid}]...` :
            eventName == 'disconnect' ? `[${new Date()}]:玩家[${me.name}]断开连接了...` : '';
        console.info(log);
        if (me.rid > 0) {
            socket.leave(`7szh-${me.rid}`);
            const room = getRoom(me.rid);
            if (!room) throw new Error(`${eventName}:未找到房间,rid:${me.rid}`);
            const pidx = getIdxById(me.id, room.players);
            if (pidx < 2) {
                --room.onlinePlayersCnt;
                if (room.isStart) me.isOffline = true;
            }
            if (!room.isStart) {
                me.rid = -1;
                removeById(pid, room.players);
            }
            if (room.onlinePlayersCnt <= 0) {
                room.players.forEach(p => p.rid = -1);
                removeById(room.id, roomList);
            } else {
                roomInfoUpdate(room.id);
            }
        }
        if (eventName == 'disconnect') removePlayer(me.id);
        emitPlayerList();
    }
    // 登录/改名/重连
    socket.on('login', data => {
        const { id = -1, name = '' } = data;
        let username = name;
        pid = id;
        const player = getPlayer(id);
        if (id > 0 && player) {
            const prevname = player.name;
            if (name != '' && prevname != name) {
                player.name = name;
                console.info(`[${new Date()}]:玩家[${prevname}]改名为[${name}]`);
            } else {
                username = prevname;
                console.info(`[${new Date()}]:玩家[${prevname}]重新连接了...`);
                removePlayerList.get(id)?.cancel();
                if (player.rid > 0 && getRoomIdx(player.rid) > -1) {
                    socket.emit('continueGame', { roomId: player.rid });
                }
            }
        } else {
            console.info(`[${new Date()}]:新玩家[${name}]连接了...`);
            pid = genId(playerList);
            playerList.push({ id: pid, name, rid: -1 });
        }
        socket.emit('login', { pid, name: username });
        emitPlayerList();
        emitRoomList();
    });
    // 发送玩家列表
    socket.on('getPlayerList', emitPlayerList);
    // 发送房间列表
    socket.on('getRoomList', emitRoomList);
    // 断开连接
    socket.on('disconnect', () => leaveRoom('disconnect'));
    // 创建房间
    socket.on('createRoom', data => {
        const { roomName, roomPassword } = data;
        const roomId = genId(roomList);
        const me = getPlayer(pid);
        const newRoom = new GeniusInvokationGame(roomId, roomName, roomPassword);
        const player = newRoom.init(me);
        playerList[getPlayerIdx(pid)] = player;
        roomList.push(newRoom);
        socket.join(`7szh-${roomId}`);
        emitRoomList();
        emitPlayerList();
        socket.emit('enterRoom', { roomId });
    });
    // 加入房间
    socket.on('enterRoom', data => {
        const { roomId, roomPassword = '', isForce = false } = data;
        const me = getPlayer(pid);
        const room = getRoom(roomId);
        if (!room) return socket.emit('enterRoom', { err: `房间号${roomId}不存在！` });
        if (room.password != roomPassword && !isForce) return socket.emit('enterRoom', { err: '密码错误！' });
        if (me.rid > 0 && me.rid != roomId) return socket.emit('enterRoom', { err: '你还有正在进行的游戏！' });
        socket.join(`7szh-${roomId}`);
        const pidx = getIdxById(me.id, room.players);
        const isInGame = pidx > -1;
        const isLookon = room.players.length >= 2 && !isInGame;
        if (room.isStart) {
            if (isInGame) {
                ++room.onlinePlayersCnt;
                room.players[pidx].isOffline = false;
            }
        } else {
            const player = room.init(me);
            playerList[getPlayerIdx(pid)] = player;
        }
        emitRoomList();
        socket.emit('enterRoom', { roomId, isLookon });
    });
    // 退出房间
    socket.on('exitRoom', () => leaveRoom('exitRoom'));
    // 房间信息更新
    socket.on('roomInfoUpdate', data => roomInfoUpdate(data.roomId));
    // 发送数据到服务器
    socket.on('sendToServer', data => {
        const me = getPlayer(pid);
        const room = getRoom(me.rid);
        room.infoHandle(data, io);
    });


});

httpServer.listen(PORT, () => console.info(`服务器已在端口${PORT}启动......`));
