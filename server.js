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
            'http://gi-tcg.taim.site',
            'http://7szh.taim.site',
            'http://localhost:5500',
        ],
        methods: ['GET', 'POST']
    }
});

process.on('uncaughtException', err => console.error(err));

process.on('exit', code => console.error(code));

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
const removeById = (id, ...lists) => {
    lists.forEach(list => {
        const idx = getIdxById(id, list);
        if (idx == -1) return;
        list.splice(idx, 1);
    });
}

// 获取玩家信息
const getPlayer = pid => getById(pid, playerList);
// 获取玩家索引
const getPlayerIdx = pid => getIdxById(pid, playerList);
// 获取房间信息
const getRoom = rid => getById(rid, roomList);
// 获取房间索引
const getRoomIdx = rid => getIdxById(rid, roomList);
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
    if (!room) return console.error(`ERROR@roomInfoUpdate:房间${roomId}不存在`);
    io.to(`7szh-${room.id}`).emit('roomInfoUpdate', {
        players: room.players,
        isStart: room.isStart,
        phase: room.phase,
        countdown: room.countdown.curr,
    });
}

io.on('connection', socket => {
    let pid = -1;
    // 发送玩家和房间列表
    const emitPlayerAndRoomList = () => {
        io.emit('getPlayerAndRoomList', {
            plist: playerList.map(p => ({
                id: p.id,
                name: p.name,
                rid: p.rid ?? -1,
            })).filter(p => !removePlayerList.has(p.id)),
            rlist: roomList.map(r => ({
                id: r.id,
                name: r.name,
                isStart: r.isStart,
                playerCnt: r.players.length,
                hasPassWord: r.password != '',
            })),
        });
    }
    // 离开房间
    const leaveRoom = eventName => {
        if (pid == -1) return;
        const me = getPlayer(pid);
        if (!me) return console.error(`ERROR@leaveRoom:${eventName}:未找到玩家,me:${JSON.stringify(me)}`);
        const log = `[${new Date()}]:玩家[${me.name}]` + {
            exitRoom: `离开了房间[${me.rid}]...`,
            disconnect: `断开连接了...`,
        }[eventName] ?? eventName;
        console.info(log);
        if (me.rid > 0) {
            socket.leave(`7szh-${me.rid}`);
            const room = getRoom(me.rid);
            if (!room) return console.error(`ERROR@leaveRoom:${eventName}:未找到房间,rid:${me.rid}`);
            const pidx = getIdxById(me.id, room.players);
            if (pidx > -1) {
                --room.onlinePlayersCnt;
                if (room.isStart) me.isOffline = true;
                if (room.players?.[1]?.id == 1) --room.onlinePlayersCnt;
            }
            if (!room.isStart || pidx == -1) {
                me.rid = -1;
                removeById(pid, room.players, room.watchers);
            }
            if (room.onlinePlayersCnt <= 0) {
                room.players.forEach(p => p.rid = -1);
                if (room.countdown.timer != null) clearInterval(room.countdown.timer);
                removeById(room.id, roomList);
            } else {
                roomInfoUpdate(room.id);
            }
        }
        if (eventName == 'disconnect') removePlayer(me.id);
        emitPlayerAndRoomList();
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
                    console.info(`[${new Date()}]:玩家[${prevname}]重新进入房间[${player.rid}]`);
                    socket.emit('continueGame', { roomId: player.rid });
                }
            }
        } else {
            console.info(`[${new Date()}]:新玩家[${name}]连接了...`);
            pid = genId(playerList);
            playerList.push({ id: pid, name, rid: -1 });
        }
        socket.emit('login', { pid, name: username });
        emitPlayerAndRoomList();
    });
    // 发送玩家和房间列表
    socket.on('getPlayerAndRoomList', emitPlayerAndRoomList);
    // 断开连接
    socket.on('disconnect', () => leaveRoom('disconnect'));
    // 创建房间
    socket.on('createRoom', data => {
        const { roomName, roomPassword, countdown } = data;
        const roomId = genId(roomList);
        const me = getPlayer(pid);
        const newRoom = new GeniusInvokationGame(roomId, roomName, roomPassword, countdown);
        const player = newRoom.init(me);
        playerList[getPlayerIdx(pid)] = player;
        roomList.push(newRoom);
        socket.join(`7szh-${roomId}`);
        emitPlayerAndRoomList();
        socket.emit('enterRoom', { roomId, players: newRoom.players, countdown: newRoom.countdown.limit });
    });
    // 加入房间
    socket.on('enterRoom', data => {
        const { roomId, roomPassword = '', isForce = false } = data;
        const me = getPlayer(pid);
        const room = getRoom(roomId);
        if (!room) return socket.emit('enterRoom', { err: `房间号${roomId}不存在！` });
        if (room.password != roomPassword && !isForce) return socket.emit('enterRoom', { err: '密码错误！' });
        if (me.rid > 0 && me.rid != roomId) return socket.emit('enterRoom', { err: `你还有正在进行的游戏！rid:${me.rid}` });
        socket.join(`7szh-${roomId}`);
        const pidx = getIdxById(me.id, room.players);
        const isInGame = pidx > -1;
        const isLookon = room.players.length >= 2 && !isInGame;
        if (room.isStart && isInGame) {
            ++room.onlinePlayersCnt;
            room.players[pidx].isOffline = false;
        } else {
            const player = room.init(me);
            playerList[getPlayerIdx(pid)] = player;
        }
        emitPlayerAndRoomList();
        socket.emit('enterRoom', { roomId, isLookon, players: room.players, countdown: room.countdown.limit });
    });
    // 退出房间
    socket.on('exitRoom', () => leaveRoom('exitRoom'));
    // 房间信息更新
    socket.on('roomInfoUpdate', data => roomInfoUpdate(data.roomId));
    // 发送数据到服务器
    socket.on('sendToServer', data => {
        const me = getPlayer(pid);
        if (!me) return console.error(`ERROR@sendToServer:未找到玩家-pid:${pid}`);
        const room = getRoom(me.rid);
        if (!room) return console.error(`ERROR@sendToServer:未找到房间-rid:${me.rid}`);
        // try {
        let isStart = room.isStart;
        room.infoHandle(data, io);
        if (isStart != room.isStart) emitPlayerAndRoomList();
        // } catch (error) {
        //     console.error(`ERROR@sendToServer:${error}`);
        //     io.to(`7szh-${room.id}`).emit('getServerInfo', { error: error.toString() });
        // }
    });
    // 添加AI
    socket.on('addAI', () => {
        const me = getPlayer(pid);
        const room = getRoom(me.rid);
        room.init({ id: 1, name: '机器人' });
        emitPlayerAndRoomList();
        socket.emit('addAI', { players: room.players });
    });
    // 移除AI
    socket.on('removeAI', () => {
        const me = getPlayer(pid);
        const room = getRoom(me.rid);
        removeById(1, room.players);
        roomInfoUpdate(room.id);
        emitPlayerAndRoomList();
    });


});

httpServer.listen(PORT, () => console.info(`服务器已在端口${PORT}启动......`));
