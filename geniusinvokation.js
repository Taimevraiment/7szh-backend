
export class GeniusInvokationGame {
    #currentPlayerIdx;
    constructor(id, name, password, countdown) {
        this.id = id; // 房间id
        this.name = name || `房间${id}`; // 房间名
        this.password = password; // 房间密码
        this.players = []; // 玩家数组
        this.watchers = []; // 观战玩家
        this.#currentPlayerIdx = 0; // 当前回合玩家 currentPlayerIdx
        this.isStart = false; // 是否开始游戏
        this.phase = 0; // 阶段
        this.round = 1; // 回合数
        this.startIdx = -1; // 先手玩家
        this.onlinePlayersCnt = 0; // 在线玩家数
        this.leastPlayerCnt = 2; // 最少游戏人数
        this.mostPlayerCnt = 2; // 最多游戏人数
        this.log = []; // 当局游戏的日志
        this.resetOnly = 0; // 达到2进行统一重置
        this.taskQueueVal = { queue: [], isEndAtk: true, isQuickAction: false, isExecuting: false, statusAtk: 0, type: '' }; // 任务队列
        this.countdown = { limit: countdown, curr: 0, timer: null }; // 倒计时
    }
    get currentPlayerIdx() {
        return this.#currentPlayerIdx;
    }
    set currentPlayerIdx(val) {
        this.#currentPlayerIdx = (val + 2) % 2;
    }
    init(newPlayer) {
        const pidx = this.players.length + this.watchers.length;
        const player = {
            id: newPlayer.id,
            name: newPlayer.name,
            rid: this.id, // 房间id
            handCards: [], // 手牌
            heros: [], // 登场英雄
            pile: [], // 摸牌堆
            site: [], // 场地卡
            summon: [], // 召唤物
            dice: [], // 骰子
            diceSelect: [], // 骰子选择数组
            rollCnt: -1, // 投掷次数
            status: Player.STATUS.WAITING,
            phase: Player.PHASE.NOT_READY,
            info: '', // 右上角提示信息
            willGetCard: [],
            willAddCard: [],
            willDiscard: [[], []],
            hidx: -1,
            did: newPlayer.did ?? -1,
            canAction: false,
            isUsedSubType8: false,
            playerInfo: {
                artifactCnt: 0,
                artifactTypeCnt: 0,
                weaponCnt: 0,
                weaponTypeCnt: 0,
                talentCnt: 0,
                talentTypeCnt: 0,
                usedCardIds: [],
                destroyedSite: 0,
                oppoGetElDmgType: 0,
                discardCnt: 0,
                reconcileCnt: 0,
                discardIds: [],
                initCardIds: [],
                isKillCurRound: false,
            },
            isOffline: false,
        };
        if (pidx < 2) {
            this.players.push(player);
            this.onlinePlayersCnt = Math.min(2, this.players.length);
        } else {
            this.watchers.push(player);
        }
        this.players.forEach((p, pi) => p.pidx = pi);
        console.info(`init-rid:${this.id}-pid:${newPlayer.id}-pidx:${pidx}`);
        return player;
    }
    start() {
        this.isStart = true;
        this.currentPlayerIdx = this.players[1].id == 1 ? 0 : Math.floor(Math.random() * 2);
        this.startIdx = this.currentPlayerIdx;
        this.phase = Player.PHASE.CHANGE_CARD;
        this.round = 1;
        this.log = [];
        this.players.forEach(p => {
            p.phase = this.phase;
            p.site = [];
            p.summon = [];
            p.dice = [];
            p.diceSelect = [];
            p.status = Player.STATUS.WAITING;
            p.isUsedSubType8 = false;
            p.playerInfo.weaponTypeCnt = new Set(p.pile.filter(c => c.subType.includes(0))).size;
            p.playerInfo.weaponCnt = p.pile.filter(c => c.subType.includes(0)).length;
            p.playerInfo.artifactTypeCnt = new Set(p.pile.filter(c => c.subType.includes(1))).size;
            p.playerInfo.artifactCnt = p.pile.filter(c => c.subType.includes(1)).length;
            p.playerInfo.talentTypeCnt = new Set(p.pile.filter(c => c.subType.includes(6))).size;
            p.playerInfo.talentCnt = p.pile.filter(c => c.subType.includes(6)).length;
            p.playerInfo.initCardIds = [...new Set(p.pile.map(c => c.id))];
            for (let i = 0; i < 3; ++i) p.pile.sort(() => Math.random() - 0.5);
            for (let i = 0; i < 4; ++i) {
                const subtype8Idx = p.pile.findIndex((c, ci) => ci >= i && c.subType.includes(8));
                if (subtype8Idx == -1) break;
                [p.pile[i], p.pile[subtype8Idx]] = [p.pile[subtype8Idx], p.pile[i]];
            }
            p.handCards = [...p.pile.splice(0, 5)];
            p.info = `${this.startIdx == p.pidx ? '我方' : '对方'}先手`;
            this.log.push(p.handCards.reduce((a, c) => a += `[${c.name}]`, `[${p.name}]获得手牌`));
        });
        console.info(`[${this.id}]start`);
    }
    infoHandle(data, io) {
        let emitFlag = 'roomInfoUpdate';
        const dataOpt = { isSendActionInfo: false };
        const emit = (option = {}, flag = '', isSend = true) => {
            const rdata = {
                ...option,
                players: this.players,
                phase: this.phase,
                isStart: this.isStart,
                round: this.round,
                startIdx: this.startIdx,
                execIdx: this.players[0].isOffline ? 1 : 0,
                currCountdown: this.countdown.curr,
                log: this.log,
                flag: dataOpt.flag ?? flag,
            };
            console.info(`[${this.id}]server:`, flag);
            if (!data) rdata.taskQueueVal = this.taskQueueVal;
            if (isSend) io.to(`7szh-${this.id}`).emit(data ? 'getServerInfo' : 'roomInfoUpdate', rdata);
            return data;
        }
        if (data) {
            const { phase, cpidx, did, heros, eheros, cards, cidxs, hidx, dices, currCard, roundPhase, reconcile,
                handCards, currSkill, endPhase, summonee, currSummon, currSite, site, giveup, step, isInvalid,
                willDamage, willAttachs, dmgElements, outStatus, esummon, cardres, siteres, rollCnt, failTask,
                isEndAtk, statusId, dieChangeBack, isQuickAction, willHeals, slotres, playerInfo,
                currStatus, statuscmd, hidxs, resetOnly, cmds, elTips, updateToServerOnly, isUseSkill,
                taskVal, isChangeHero, sites, skillcmds, smncmds, tarhidx, etarhidx, edices, changeFrom, flag } = data;
            emitFlag = flag ?? 'roomInfoUpdate';
            console.info(`[${this.id}]flag:`, emitFlag);
            // if (step != undefined) {
            //     if (this.taskQueueVal.step != -1 && step != this.taskQueueVal.step + 1 || this.taskQueueVal.step == -1 && step != 1) return;
            //     this.taskQueueVal.step = step;
            // }
            if (roundPhase == this.phase) return;
            if (taskVal || emitFlag === 'roomInfoUpdate') {
                if (taskVal) {
                    this.taskQueueVal.queue = taskVal.queue;
                    this.taskQueueVal.isExecuting = taskVal.isExecuting;
                    this.taskQueueVal.statusAtk = taskVal.statusAtk;
                }
                dataOpt.taskQueueVal = this.taskQueueVal;
                emit(dataOpt, 'update-taskQueue');
                if (taskVal) return;
            }
            const cidx = cpidx ?? this.currentPlayerIdx;
            dataOpt.cidx = cidx;
            if (giveup) return this.giveup(cidx, dataOpt, emit);
            if (failTask) {
                dataOpt.isTaskFail = true;
                this.changeTurn(cidx, true, this.taskQueueVal.isQuickAction, false, this.taskQueueVal.type, dataOpt, emit);
            }
            if (phase != undefined) this.players[cidx].phase = phase;
            if (roundPhase != undefined) this.phase = roundPhase;
            this.setDeck(did, cidx, cards); // 装配出站卡组
            if (playerInfo) this.players[cidx].playerInfo = playerInfo;
            if (heros) this.players[cidx].heros = [...heros];
            if (eheros) this.players[cidx ^ 1].heros = [...eheros];
            if (sites) this.players.forEach((p, pi) => p.site = [...sites[pi]]);
            if (currSite == undefined && site != undefined) this.players[cidx].site = [...site];
            if (currSummon == undefined && summonee != undefined) this.players[cidx].summon = [...summonee];
            if (edices) this.players[cidx ^ 1].dice = [...edices.val];
            if (rollCnt) this.players[cidx].rollCnt = rollCnt;
            if (changeFrom != undefined) dataOpt.changeFrom = changeFrom;
            if ((currSkill?.type ?? -1) > 0 || isUseSkill) dataOpt.isUseSkill = true;
            if (updateToServerOnly) return;
            if (handCards != undefined) this.players[cidx].handCards = [...handCards];
            if (cmds) this.doCmd(cmds, cidx, dataOpt, emit);
            if (resetOnly) {
                this.players[cidx].playerInfo.disCardCnt = 0;
                this.players[cidx].playerInfo.reconcileCnt = 0;
                this.players[cidx].playerInfo.isKillCurRound = failTask;
                if (++this.resetOnly >= 2) this.resetOnly = 0;
                dataOpt.resetOnly = true;
                return emit(dataOpt, `reset-${cidx}`);
            }
            this.changeCard(cidxs, cidx, dataOpt, emit); // 换牌
            if (isEndAtk != undefined) dataOpt.isEndAtk = isEndAtk;
            this.modifyHero(hidx, cidx, isChangeHero, dieChangeBack, isQuickAction, isEndAtk, dataOpt, emit); // 改变角色状态
            this.doDice(dices, cidx, dataOpt, emit); // 掷骰子
            this.startPhaseEnd(dataOpt); // 开始阶段结束
            if (willDamage == undefined && esummon != undefined) this.players[cidx ^ 1].summon = [...esummon];
            this.useCard(currCard, reconcile, cardres, cidx, hidxs, isInvalid, dataOpt, emit); // 出牌
            if (currSummon == undefined || !currSummon.isSelected && summonee == undefined && currSummon?.damage > 0) { // 受伤
                const isSwitch = [...(cmds ?? []), ...(smncmds ?? []), ...(skillcmds?.[0] ?? [])].find(({ cmd, isOppo }) => cmd.includes('switch') && isOppo)?.hidxs?.[0] ?? -1;
                this.getDamage(willDamage, willAttachs, cidx, esummon, statusId, currSkill, isEndAtk,
                    dmgElements, currSummon, currStatus, currCard, isSwitch, dataOpt, emit);
            }
            if (elTips) dataOpt.elTips = elTips;
            this.doSlot(slotres, cidx, isEndAtk, isQuickAction, dataOpt, emit);
            this.heal(willHeals, dataOpt); // 回血
            this.useSkill(currSkill, cidx, skillcmds, isEndAtk, isQuickAction, tarhidx, etarhidx, dataOpt, emit); // 使用技能
            if (this.players.every(p => p.phase == Player.PHASE.NOT_BEGIN)) { // 两人都已准备
                this.start();
            }
            if (this.players.every(p => p.phase == Player.PHASE.DICE)) { // 两人都选完出战角色
                this.phase = Player.PHASE.DICE;
            }
            if (this.phase == Player.PHASE.ACTION_END && (currSummon || currSite || currStatus)) { // 结束阶段召唤物、场地、状态发动
                this.players[cidx].status = Player.STATUS.PLAYING;
                this.players[cidx ^ 1].status = Player.STATUS.WAITING;
            }
            this.doSkill(currSkill, cidx, isEndAtk, isQuickAction, dataOpt, emit); // 角色技能发动
            this.doStatus(currStatus, statuscmd, cidx, hidx, isEndAtk, isQuickAction, dataOpt, emit); // 角色状态发动
            this.doSummon(currSummon, cidx, summonee, outStatus, smncmds, isEndAtk, isQuickAction, dataOpt, emit, step); // 召唤物行动
            this.doSite(currSite, cidx, site, siteres, isEndAtk, isQuickAction, dataOpt, emit, step); // 场地效果发动
            this.endPhase(endPhase, cidx, isEndAtk, dataOpt, emit); // 结束回合
            if (this.players.every(p => p.phase == Player.PHASE.ACTION_END) && this.phase == Player.PHASE.ACTION) { // 两人都结束当前回合
                this.phase = Player.PHASE.ACTION_END;
                console.info(`[${this.id}]action-end`);
            }
            this.endPhaseEnd(dataOpt, emit); // 结束阶段结束
        }
        emit(dataOpt, 'infoHandle:' + emitFlag);
    }
    setDeck(did, cidx, cards) { // 装配出站卡组
        if (did == undefined) return;
        this.players[cidx].did = did;
        this.players[cidx].pile = [...cards];
    }
    changeCard(cidxs, cidx, dataOpt, emit) { // 换牌
        if (cidxs == undefined) return;
        const player = this.players[cidx];
        const idxPool = [];
        while (cidxs.length > 0) {
            const cardidx = cidxs.shift();
            const genRanIdx = () => {
                let idx;
                while (true) {
                    idx = Math.floor(Math.random() * player.pile.length);
                    if (!idxPool.includes(idx)) {
                        idxPool.push(idx);
                        return idx;
                    }
                }
            }
            const ranIdx = genRanIdx();
            [player.handCards[cardidx], player.pile[ranIdx]] = [player.pile[ranIdx], player.handCards[cardidx]];
        }
        if (this.phase == Player.PHASE.ACTION) {
            setTimeout(() => {
                this.players[cidx].phase = Player.PHASE.ACTION;
                emit(dataOpt, 'changeCard-action');
            }, 800);
        } else {
            this.log.push(player.handCards.reduce((a, c) => a + `[${c.name}]`, `[${player.name}]换牌后手牌为`));
            player.info = `${this.startIdx == player.pidx ? '我方' : '对方'}先手，等待对方选择......`;
            setTimeout(() => {
                player.phase = Player.PHASE.CHOOSE_HERO;
                emit(dataOpt, 'changeCard');
            }, player.id == 1 ? 0 : 800);
        }
    }
    modifyHero(hidx, cidx, isChangeHero, dieChangeBack, isQuickAction, isEndAtk, dataOpt, emit) { // 改变角色状态
        if (hidx == undefined || !isChangeHero) return;
        dataOpt.changeTo = cidx;
        if (this.players[cidx].phase == Player.PHASE.CHOOSE_HERO) { // 选择出战角色
            this.players[cidx].hidx = hidx;
            this.players[cidx].heros.forEach((h, idx) => h.isFront = idx == hidx);
            dataOpt.isSendActionInfo = false;
            dataOpt.chooseInitHero = true;
            this.players[cidx].phase = Player.PHASE.DICE;
            this.log.push(`[${this.players[cidx].name}]选择[${this.players[cidx].heros[hidx].name}]出战`);
        } else { // 切换角色
            const ohidx = this.players[cidx].hidx;
            this.changeHero(cidx, hidx, dataOpt);
            dataOpt.actionAfter = [cidx, 2];
            if (dieChangeBack) { // 阵亡后选择出战角色
                dataOpt.dieChangeBack = this.players[cidx].phase;
                this.players[cidx].heros[ohidx].inStatus = this.players[cidx].heros[ohidx].inStatus.filter(ist => ist.type.includes(12));
                this.players[cidx].phase -= 3;
                const isOppoActioning = this.players[cidx ^ 1].phase == Player.PHASE.ACTION;
                this.players[cidx].info = isOppoActioning ? '对方行动中....' : '';
                const isActioning = this.players[cidx].phase == Player.PHASE.ACTION;
                this.players[cidx ^ 1].info = isActioning ? '对方行动中....' : '对方结束已结束回合...';
                if (isOppoActioning) this.players[this.currentPlayerIdx].canAction = true;
                isEndAtk &&= this.taskQueueVal.isEndAtk;
                isQuickAction ||= this.taskQueueVal.isQuickAction;
            }
            this.changeTurn(cidx, isEndAtk, isQuickAction, dieChangeBack, 'changeHero', dataOpt, emit);
            dataOpt.isSendActionInfo = 1000;
            if (this.players?.[cidx]?.heros?.[hidx] == undefined) {
                console.error(`ERROR@modifyHero: cidx:${cidx},hidx:${hidx}`);
            }
            this.log.push(`[${this.players[cidx].name}]切换为[${this.players[cidx].heros[hidx].name}]出战${isQuickAction && !dieChangeBack ? '(快速行动)' : ''}`);
        }
    }
    doDice(dices, cidx, dataOpt, emit) { // 掷骰子
        if (dices == undefined) return;
        this.players[cidx].dice = [...dices.val];
        if (this.phase == Player.PHASE.DICE) { // 掷骰子
            setTimeout(() => {
                if (dices.isDone) this.players[cidx].phase = Player.PHASE.ACTION_START;
                if (this.players.every(p => p.phase == Player.PHASE.ACTION_START)) { // 两人都掷完骰子，进入回合开始阶段
                    this.phase = Player.PHASE.ACTION_START;
                    this.players[this.currentPlayerIdx].canAction = true;
                }
                emit(dataOpt, 'doDice-phase');
            }, 1500);
        } else if (this.phase == Player.PHASE.ACTION) {
            if (dices.isDone) {
                setTimeout(() => {
                    this.players[cidx].phase = Player.PHASE.ACTION;
                    emit(dataOpt, 'doDice-action');
                }, 1500);
            }
        }
    }
    startPhaseEnd(dataOpt) { // 开始阶段结束
        if (this.phase == Player.PHASE.ACTION &&
            this.players[0].phase == Player.PHASE.ACTION_START
        ) {
            this.players.forEach(p => p.phase = Player.PHASE.ACTION);
            this.players[this.startIdx].status = Player.STATUS.PLAYING;
            this.players.forEach(p => {
                if (p.pidx == this.startIdx) p.info = '';
                else p.info = '对方行动中....';
            });
            this.startTimer(dataOpt);
        }
    }
    useCard(currCard, reconcile, cardres, cidx, hidxs, isInvalid, dataOpt, emit) { // 出牌
        if (currCard == undefined || currCard.id <= 0) return;
        dataOpt.isSendActionInfo = 800;
        dataOpt.actionAfter = [cidx, currCard.subType.includes(7) && !reconcile ? 2 : 1];
        if (reconcile) { // 调和
            this.log.push(`[${this.players[cidx].name}]将[${currCard.name}]进行了调和`);
        } else { // 出牌
            const usedCardIds = this.players[cidx].playerInfo.usedCardIds;
            if (!usedCardIds.includes(currCard.id)) usedCardIds.push(currCard.id);
            if (cardres && cardres?.cmds) {
                this.doCmd(cardres.cmds, cidx, dataOpt, emit);
            }
            if (currCard.subType.includes(8)) this.players[cidx].isUsedSubType8 = true;
            if (currCard.type == 0 && !cardres?.isDestroy) { // 装备
                const tarHero = this.players[cidx].heros[hidxs[0]];
                if (currCard.subType.includes(0)) { // 武器
                    tarHero.weaponSlot = { ...currCard };
                } else if (currCard.subType.includes(1)) { // 圣遗物
                    tarHero.artifactSlot = { ...currCard };
                } else if (currCard.subType.includes(6)) { // 天赋
                    tarHero.talentSlot = { ...currCard };
                }
            }
            if (currCard.subType.includes(7)) {
                this.players[cidx].canAction = false;
                if (currCard.type == 2 || isInvalid) {
                    this.changeTurn(cidx, true, false, false, 'useCard', dataOpt, emit);
                }
            } else dataOpt.actionStart = cidx;
            this.log.push(`[${this.players[cidx].name}]使用了[${currCard.name}]`);
        }
        this.startTimer(dataOpt);
    }
    getDamage(willDamage, willAttachs, cidx, esummon, statusId, currSkill, isEndAtk,
        dmgElements, currSummon, currStatus, currCard, isSwitch, dataOpt, emit
    ) { // 受伤
        if (willDamage == undefined) return;
        dataOpt.willAttachs = willAttachs;
        dataOpt.dmgElements = dmgElements;
        let isDie = false;
        this.players.forEach((p, pi) => {
            let heroDie = -1;
            p.heros.forEach((h, hi) => {
                if (h.hp > 0) {
                    h.hp = Math.max(0, h.hp - willDamage[hi + (pi ^ 1) * this.players[pi ^ 1].heros.length].reduce((a, b) => a + Math.max(0, b), 0));
                    if (h.hp <= 0 && h.inStatus.every(ist => !ist.type.includes(13)) && !h.talentSlot?.subType.includes(-4)) {
                        h.inStatus.forEach(ist => {
                            if (ist.type.indexOf(12) == -1) {
                                ist.useCnt = 0;
                                ist.roundCnt = 0;
                            }
                        });
                        h.talentSlot = null;
                        h.artifactSlot = null;
                        h.weaponSlot = null;
                        h.attachElement = [];
                        h.energy = 0;
                        const winnerIdx = this.isWin(dataOpt, emit);
                        this.players[pi ^ 1].canAction = false;
                        if (winnerIdx > -1) dataOpt.winnerIdx = winnerIdx;
                        else if (h.isFront) heroDie = hi;
                    }
                } else {
                    willDamage[hi + (pi ^ 1) * 3] = [-1, 0];
                }
            });
            if (heroDie > -1) {
                if (isSwitch > -1 && this.players[pi].heros[isSwitch].hp > 0) {
                    heroDie = -1;
                } else {
                    isDie = true;
                    this.players[pi].phase += 3;
                    this.players[pi].info = '请选择出战角色...';
                    this.players[pi ^ 1].info = '等待对方选择出战角色......';
                    this.players[pi ^ 1].playerInfo.isKillCurRound = true;
                    const diehi = heroDie;
                    setTimeout(() => {
                        this.players[pi].heros[diehi].isFront = false;
                        this._clearObjAttr(dataOpt);
                        dataOpt.heroDie = pi;
                        dataOpt.isSendActionInfo = false;
                        emit(dataOpt, 'getDamage-heroDie');
                    }, 2400);
                }
            }
        });
        dataOpt.willDamage = willDamage;
        if (esummon) this.players[cidx ^ 1].summon = [...esummon];
        let isQuickAction = false;
        if (statusId) { // 阵营/角色状态发动额外攻击/回血
            dataOpt.isSendActionInfo = 2000;
            if (statusId.length > 0) {
                const [stsId, stype, ohidx = -1, isSwitchAtking, iqa] = statusId;
                isQuickAction = iqa;
                const status = ['inStatus', 'outStatus'][stype];
                const stsidx = ohidx == -1 || stype == -1 ? this.players[cidx].hidx : ohidx;
                const stshero = this.players[cidx].heros[stsidx];
                const curStatuses = stshero[status];
                const curStatus = curStatuses.find(sts => sts.id == stsId);
                if (curStatus == undefined) {
                    throw new Error(`[${this.players[cidx].name}][${stshero.name}][${status}]:${JSON.stringify(curStatuses)}`);
                }
                curStatus.isSelected = true;
                this.log.push(`[${this.players[cidx].name}][${curStatus.name}]发动`);
                setTimeout(() => {
                    let ncurStatus = this.players[cidx].heros[stsidx][status].find(sts => sts.id == stsId) ?? curStatus;
                    ncurStatus.isSelected = false;
                    if (ncurStatus.useCnt == 0) ncurStatus.type.splice(ncurStatus.type.indexOf(1), 1);
                    this.players[cidx].summon = this.players[cidx].summon.filter(smn => smn.useCnt > 0 || smn.isDestroy > 0);
                    this._clearObjAttr(dataOpt);
                    if (isSwitchAtking) dataOpt.isSwitchAtking = true;
                    this.completeTask(dataOpt);
                    emit(dataOpt, `getDamage-${status}`);
                }, 1600);
            }
        }
        if (currSkill == undefined && currSummon == undefined && this.phase == Player.PHASE.ACTION && !isDie) {
            this.changeTurn(cidx, isEndAtk, isQuickAction, false, 'getDamage-status', dataOpt, emit);
        }
        if (currStatus != undefined || currCard != undefined) this.players[cidx].canAction = true;
    }
    heal(willHeals, dataOpt) { // 回血
        if (willHeals == undefined) return;
        if (dataOpt.willHeals != undefined) return console.error(`ERROR@heal:doCmd已有回血，此处回血失效！`);
        dataOpt.willHeals = [-1, -1, -1, -1, -1, -1];
        this.players.forEach((p, pi) => {
            p.heros.forEach((h, hi) => {
                const heal = Math.min(willHeals[hi + (pi ^ 1) * 3], h.maxhp - h.hp);
                if (h.hp > 0 && heal >= 0) {
                    h.hp += heal;
                    dataOpt.willHeals[hi + (pi ^ 1) * 3] = heal;
                }
            });
        });
    }
    useSkill(currSkill, cidx, skillcmds, isEndAtk, isQuickAction, tarhidx, etarhidx, dataOpt, emit) { // 使用技能
        if (currSkill == undefined || currSkill.type <= 0 || currSkill.type > 3) return;
        dataOpt.actionAfter = [cidx, 2];
        const frontHero = this.players[cidx].heros[this.players[cidx].hidx];
        this.players[cidx].tarhidx = tarhidx;
        this.players[cidx ^ 1].tarhidx = etarhidx;
        this.changeTurn(cidx, isEndAtk, isQuickAction, false, 'useSkill', dataOpt, emit);
        dataOpt.isSendActionInfo = 2100;
        this.doCmd(skillcmds[0], cidx, dataOpt, emit);
        this.doCmd(skillcmds[1], cidx ^ 1, dataOpt, emit);
        this.log.push(`[${this.players[cidx].name}][${frontHero.name}]使用了[${SKILL_TYPE[currSkill.type]}][${currSkill.name}]`);
        this.startTimer(dataOpt);
    }
    changeTurn(cidx, isEndAtk, isQuickAction, dieChangeBack, type, dataOpt, emit) {// 转变回合人
        const isOppoActionEnd = this.players[cidx ^ 1]?.phase >= Player.PHASE.ACTION_END;
        let canChange = false;
        this.players[cidx].canAction = false;
        let timeout = 2400;
        this.taskQueueVal.isEndAtk = isEndAtk;
        this.taskQueueVal.isQuickAction = isQuickAction;
        this.taskQueueVal.type = type;
        if (type == 'changeHero') { // 如果有速切或对方结束回合或有额外攻击则不转变回合
            canChange = isEndAtk && (!dieChangeBack && !isOppoActionEnd && !isQuickAction ||
                dieChangeBack && this.players[cidx]?.phase < Player.PHASE.ACTION_END);
            if (isOppoActionEnd) timeout = 2000;
        } else if (['useSkill', 'doSlot', 'doSummon', 'doSite', 'getDamage-status', 'useCard', 'doStatus', 'doSkill'].includes(type)) { // 如果对方已经结束则不转变
            canChange = !isOppoActionEnd && isEndAtk && !isQuickAction;
            if (['doSummon', 'doStatus', 'doSlot', 'doSkill'].includes(type)) timeout = 0;
        } else if (type == 'endPhase') {
            canChange = isEndAtk;
            timeout = 100;
        }
        if (!canChange || dataOpt.isTaskFail) timeout = 0;
        setTimeout(() => {
            if (canChange) {
                this.players[this.currentPlayerIdx].status = Player.STATUS.WAITING;
                ++this.currentPlayerIdx;
                this.players[this.currentPlayerIdx].status = Player.STATUS.PLAYING;
                if (type == 'endPhase') {
                    this.startTimer(dataOpt);
                } else {
                    this.players.forEach(p => {
                        if (p.pidx == this.currentPlayerIdx) p.info = '';
                        else p.info = '对方行动中....';
                    });
                }
                const curPlayer = this.players[this.currentPlayerIdx];
                if (curPlayer.heros[curPlayer.hidx].inStatus.every(ist => !ist.type.includes(11)) ||
                    curPlayer.heros[curPlayer.hidx].inStatus.some(ist => ist.type.includes(14))) {
                    curPlayer.canAction = true;
                }
            } else {
                const ephase = this.players[this.currentPlayerIdx ^ 1]?.phase ?? 0;
                if ((ephase > Player.PHASE.ACTION && dataOpt.heroDie == undefined || isQuickAction) && isEndAtk) {
                    this.players[this.currentPlayerIdx].canAction = true;
                }
            }
            this._clearObjAttr(dataOpt);
            dataOpt.isSendActionInfo = false;
            dataOpt.actionStart = this.currentPlayerIdx;
            emit(dataOpt, 'changeTurn-' + type + '-canChange:' + canChange);
        }, timeout);
    }
    endPhase(endPhase, cidx, isEndAtk, dataOpt, emit) { // 结束回合
        if (!endPhase) return;
        this.players[cidx].phase = Player.PHASE.ACTION_END;
        if (this.players[cidx ^ 1].phase < Player.PHASE.ACTION_END) {
            this.startIdx = cidx;
        }
        this.players[this.currentPlayerIdx].canAction = false;
        // if (isEndAtk) {
        //     setTimeout(() => {
        //         this.players[this.currentPlayerIdx].status = Player.STATUS.WAITING;
        //         ++this.currentPlayerIdx;
        //         this.players[this.currentPlayerIdx].status = Player.STATUS.PLAYING;
        //         dataOpt.actionStart = this.currentPlayerIdx;
        //         dataOpt.isSendActionInfo = false;
        //         this.startTimer(dataOpt);
        //         emit(dataOpt, 'endPhase-hasStatusAtk');
        //     }, 100);
        // }
        this.changeTurn(cidx, isEndAtk, false, false, 'endPhase', dataOpt, emit);
        const isEndPhase = this.players.every(p => p.phase == Player.PHASE.ACTION_END);
        this.players.forEach(p => {
            if (isEndPhase) p.info = '结束阶段...';
            else if (p.pidx == this.currentPlayerIdx) p.info = '对方行动中....';
            else p.info = '对方结束已结束回合...';
        });
        dataOpt.isSendActionInfo = 2100;
        this.players[this.currentPlayerIdx ^ 1].canAction = true;
        this.log.push(`[${this.players[cidx].name}]结束了回合`);
    }
    doSkill(currSkill, cidx, isEndAtk, isQuickAction, dataOpt, emit) { // 技能效果发动
        if (currSkill == undefined || currSkill.type != -2) return;
        const { hidx, skidx } = currSkill;
        const hero = this.players[cidx].heros[hidx];
        const skill = hero.skills[skidx];
        hero.isSelected = 1;
        this.log.push(`[${this.players[cidx].name}][${SKILL_TYPE[skill.type]}][${skill.name}]发动`);
        dataOpt.isSendActionInfo = 1000;
        setTimeout(() => {
            hero.isSelected = 0;
            dataOpt.isSendActionInfo = false;
            this.changeTurn(cidx, isEndAtk, isQuickAction, false, 'doSkill', dataOpt, emit);
        }, 700);
    }
    doSlot(slotres, cidx, isEndAtk, isQuickAction, dataOpt, emit) { // 装备效果发动
        if (slotres == undefined) return;
        const { cmds, slotIds: [hidx, slot] } = slotres;
        const subtypeList = ['weaponSlot', 'artifactSlot', , , , , 'talentSlot'];
        const curSlot = this.players[cidx].heros[hidx][subtypeList[slot.subType[0]]] = slot;
        curSlot.selected = true;
        this.log.push(`[${this.players[cidx].name}][${curSlot.name}]发动`);
        dataOpt.isSendActionInfo = 700;
        this.doCmd(cmds, cidx, dataOpt, emit);
        if (isEndAtk) this.players[cidx].canAction = false;
        setTimeout(() => {
            this.players[cidx].heros[hidx][subtypeList[slot.subType[0]]].selected = false;
            delete dataOpt.willHeals;
            dataOpt.isSendActionInfo = false;
            this.completeTask(dataOpt);
            this.changeTurn(cidx, isEndAtk, isQuickAction, false, 'doSlot', dataOpt, emit);
        }, 500);
    }
    doStatus(currStatus, statuscmd, cidx, hidx, isEndAtk, isQuickAction, dataOpt, emit) { // 角色状态发动
        if (currStatus == undefined || statuscmd == undefined) return;
        const [cmd, type] = statuscmd;
        const status = ['inStatus', 'outStatus'][type];
        const curStatusIdx = this.players[cidx].heros[hidx][status].findIndex(sts => sts.id == currStatus.id);
        this.players[cidx].heros[hidx][status][curStatusIdx] = currStatus;
        const curStatus = this.players[cidx].heros[hidx][status][curStatusIdx];
        curStatus.isSelected = true;
        if (curStatus.useCnt == 0 && !curStatus.type.includes(15)) curStatus.type.push(15);
        const emitFlag = `do${['In', 'Out'][type]}Status-`;
        emit(dataOpt, `${emitFlag}start`);
        this.doCmd(cmd, cidx, dataOpt, emit);
        this.log.push(`[${this.players[cidx].name}][${curStatus.name}]发动`);
        dataOpt.isSendActionInfo = 1000;
        setTimeout(() => {
            curStatus.isSelected = false;
            if (curStatus.useCnt == 0 && curStatus.type.indexOf(15) > -1) curStatus.type.splice(curStatus.type.indexOf(15), 1);
            dataOpt.isSendActionInfo = false;
            this.completeTask(dataOpt);
            emit(dataOpt, `${emitFlag}end`);
            this.changeTurn(cidx, isEndAtk, isQuickAction, false, 'doStatus', dataOpt, emit);
        }, 1000);
    }
    doSummon(currSummon, cidx, summonee, outStatus, smncmds, isEndAtk, isQuickAction, dataOpt, emit, step) { // 召唤物行动
        if (currSummon == undefined) return;
        const curPlayer = this.players[cidx];
        const cursummon = curPlayer.summon.find(smn => smn.id == currSummon.id);
        if (summonee != undefined) {
            if (step == 3) cursummon.isSelected = false; // 边框变暗
            else if (step == 4) { // 更新summon数据
                curPlayer.summon = [...summonee];
                if (outStatus) curPlayer.heros[curPlayer.hidx].outStatus = [...outStatus];
                if (this.phase == Player.PHASE.ACTION) {
                    this.changeTurn(cidx, isEndAtk, isQuickAction, false, 'doSummon', dataOpt, emit);
                }
                this.completeTask(dataOpt);
            }
        } else {
            if (step == 1) { // 边框变亮
                cursummon.isSelected = true;
            } else if (step == 2) { // 扣血、显示伤害
                cursummon.useCnt = currSummon.useCnt;
                cursummon.element = currSummon.element;
                if (smncmds) this.doCmd(smncmds, cidx, dataOpt, emit);
                dataOpt.isSendActionInfo = 1600;
                this.log.push(`[${curPlayer.name}][${currSummon.name}]发动`);
            }
        }
    }
    doSite(currSite, cidx, site, siteres, isEndAtk, isQuickAction, dataOpt, emit, step) { // 场地效果发动
        if (currSite == undefined) return;
        if (this.phase == Player.PHASE.ACTION_END) {
            this.players[cidx].status = Player.STATUS.PLAYING;
            this.players[cidx ^ 1].status = Player.STATUS.WAITING;
        }
        const cursiteIdx = this.players[cidx].site.findIndex(st => st.sid == currSite.sid);
        if (cursiteIdx == -1) return;
        const cursite = this.players[cidx].site[cursiteIdx];
        if (site != undefined) {
            if (step == 3) cursite.isSelected = false; // 边框变暗
            else if (step == 4) { // 更新site数据
                if (siteres?.isDestroy) {
                    this.players[cidx].site.splice(cursiteIdx, 1);
                }
                if (this.players[cidx].phase == Player.PHASE.ACTION) {
                    this.changeTurn(cidx, isEndAtk, isQuickAction, false, 'doSite', dataOpt, emit);
                }
                this.completeTask(dataOpt);
            }
        } else {
            if (step == 1) { // 边框变亮
                cursite.isSelected = true;
            } else if (step == 2) { // 数量、效果变化
                if (siteres?.cmds) {
                    this.doCmd(siteres.cmds, cidx, dataOpt, emit);
                }
                cursite.cnt = currSite.cnt;
                cursite.perCnt = currSite.perCnt;
            }
        }
    }
    endPhaseEnd(dataOpt, emit) { // 结束阶段结束
        if (this.phase != Player.PHASE.PHASE_END) return;
        this.currentPlayerIdx = this.startIdx;
        // this.dispatchCard(-1, { cnt: 2 }, dataOpt, emit);
        setTimeout(() => {
            ++this.round;
            this.phase = Player.PHASE.DICE;
            this.players.forEach(p => {
                p.status = Player.STATUS.WAITING;
                p.phase = Player.PHASE.DICE;
                p.dice = [];
                p.info = '等待对方选择......';
                p.heros.forEach(h => {
                    if (h.hp == 0) h.hp = -1;
                });
            });
            emit(dataOpt, 'endPhaseEnd');
        }, 1600);
    }
    changeHero(cidx, hidx, dataOpt) {
        const ohidx = this.players[cidx].hidx;
        const outStatus = this.players[cidx].heros[ohidx].outStatus.map(v => JSON.parse(JSON.stringify(v)));
        this.players[cidx].heros.forEach((h, idx) => {
            h.isFront = idx == hidx;
            if (h.isFront) {
                h.outStatus = outStatus;
                this.players[cidx].hidx = hidx;
            } else h.outStatus = [];
        });
        dataOpt.changeTo = cidx;
        dataOpt.changeFrom = ohidx;
    }
    dispatchCard(playerIdx, event, dataOpt, emit) {
        const { hidxs: exclude = [], isAttach = false } = event;
        let { cnt, subtype = [], card: gcard = [] } = event;
        if (typeof subtype == 'number') subtype = [subtype];
        if (gcard?.length == undefined) gcard = [gcard];
        while (cnt-- > 0) {
            this.players.forEach(p => {
                if (p.pidx == playerIdx || playerIdx == -1) {
                    let card = null;
                    if (gcard[cnt]) { // 摸指定卡
                        if (!isAttach) card = gcard[cnt];
                        else {
                            const cid = gcard[cnt].id;
                            const cardIdx = p.pile.findIndex(c => c.id == cid);
                            if (cardIdx > -1) card = p.pile.splice(cardIdx, 1)[0];
                        }
                    } else if (subtype.length == 0) {
                        if (p.pile.every(c => exclude.includes(c.id))) {
                            return;
                        }
                        const cardIdx = p.pile.findIndex(c => !exclude.includes(c.id));
                        if (cardIdx > -1) card = p.pile.splice(cardIdx, 1)[0];
                    } else { // 指定副类型
                        if (p.pile.every(c => c.subType.every(st => !subtype.includes(st)))) {
                            return;
                        }
                        while (card == null) {
                            const cardIdx = p.pile.findIndex(c => {
                                return c.subType.some(st => subtype.includes(st)) && !exclude.includes(c.id);
                            });
                            if (cardIdx > -1) card = p.pile.splice(cardIdx, 1)[0];
                        }
                    }
                    if (card) p.willGetCard.push(card);
                }
            });
        }
        setTimeout(() => {
            this.players.forEach(p => {
                while (p.willGetCard.length > 0 && p.handCards.length < 10) {
                    p.handCards.push(p.willGetCard.shift());
                }
                p.willGetCard = [];
            });
            this._clearObjAttr(dataOpt);
            emit(dataOpt, 'dispatchCard');
        }, 1500);
    }
    doCmd(cmds, cidx, dataOpt, emit) {
        if ((cmds?.length ?? 0) == 0) return;
        let curRound = -1;
        const willheals = [];
        for (let i = 0; i < cmds.length; ++i) {
            const { cmd, cnt, hidxs, card = [], element = 0, isOppo = false, round = 0 } = cmds[i];
            if (cmd == 'getCard') {
                this.dispatchCard(cidx ^ +isOppo, cmds[i], dataOpt, emit);
            } else if (cmd == 'heal') {
                if (curRound != round) {
                    willheals.push([-1, -1, -1, -1, -1, -1]);
                    curRound = round;
                }
                this.players[cidx].heros.forEach((h, hi) => {
                    if (h.hp > 0 && (hidxs?.includes(hi) || hidxs == undefined && h.isFront)) {
                        const hli = hi + (cidx ^ 1) * 3;
                        if (willheals[curRound][hli] == -1) willheals[curRound][hli] = 0;
                        willheals[curRound][hli] += cnt;
                    }
                });
            } else if (cmd.startsWith('switch-')) {
                const pidx = cidx ^ +isOppo;
                setTimeout(() => {
                    const heros = this.players[pidx].heros;
                    this._clearObjAttr(dataOpt, ['switchToSelf']);
                    if (heros[hidxs[0]].hp > 0) this.changeHero(pidx, hidxs[0], dataOpt);
                    dataOpt.isSendActionInfo = false;
                    emit(dataOpt, 'doCmd--' + cmd);
                }, cnt ?? 100);
            } else if (cmd == 'revive') {
                this.players[cidx].heros.forEach((h, hi) => {
                    if (hidxs == undefined && h.isFront || hidxs?.includes(hi)) {
                        h.hp = cnt;
                        if (dataOpt.willHeals == undefined) dataOpt.willHeals = [-1, -1, -1, -1, -1, -1];
                        dataOpt.willHeals[hi + (cidx ^ 1) * 3] = cnt;
                    }
                });
            } else if (cmd == 'addCard') {
                const pidx = cidx ^ +isOppo;
                this.players[pidx].willAddCard.push(...card);
                setTimeout(() => {
                    this.players[pidx].willAddCard = [];
                    const scope = hidxs?.[0] ?? 0;
                    const pileLen = this.players[pidx].pile.length;
                    let restCnt = cnt;
                    if (element == 0) { // 随机
                        let cscope = scope > 0 ? Math.max(1, scope - cnt) : scope < 0 ? Math.min(-1, scope + cnt) : scope;
                        while (restCnt-- > 0) {
                            let pos = (pileLen + Math.floor(Math.random() * (cscope || pileLen))) % pileLen;
                            if (scope < 0) {
                                ++pos;
                                cscope = Math.max(scope, cscope - 1);
                            } else if (scope > 0) {
                                cscope = Math.min(scope, cscope + 1);
                            }
                            this.players[pidx].pile.splice(pos, 0, card.shift());
                        }
                    } else { // 均匀
                        const step = Math.floor((scope || pileLen) / (cnt + 1)) + (scope < 0 ? 1 : 0);
                        while (restCnt-- > 0) {
                            let pos = (pileLen + step * (cnt - restCnt)) % pileLen;
                            this.players[pidx].pile.splice(pos, 0, card.shift());
                        }
                    }
                    this._clearObjAttr(dataOpt);
                    emit(dataOpt, 'doCmd--' + cmd);
                }, 1250);
            } else if (cmd == 'discard') {
                const pidx = cidx ^ +isOppo;
                if ([0, 1].includes(element)) { // 舍弃手牌
                    hidxs.forEach(dcidx => {
                        this.players[pidx].willDiscard[0].push(this.players[pidx].handCards[dcidx]);
                    });
                    this.players[pidx].handCards = this.players[pidx].handCards.filter((_, dcidx) => !hidxs.includes(dcidx));
                } else if ([2, 3].includes(element)) { // 舍弃牌库中的牌
                    this.players[pidx].willDiscard[1].push(...this.players[pidx].pile.filter((_, dcidx) => hidxs.includes(dcidx)));
                    this.players[pidx].pile = this.players[pidx].pile.filter((_, dcidx) => !hidxs.includes(dcidx));
                }
                this.log.push(`[${this.players[pidx].name}]舍弃了${this.players[pidx].willDiscard.map(cs => cs.map(c => `[${c.name}]`).join('')).join('')}`);
                dataOpt.isSendActionInfo = 1400;
                setTimeout(() => {
                    dataOpt.isSendActionInfo = false;
                    this.players[pidx].willDiscard = [[], []];
                    this._clearObjAttr(dataOpt);
                    emit(dataOpt, 'doCmd--' + cmd);
                }, 1500);
            }
        }
        if (willheals.length > 1) this.players[cidx].canAction = false;
        willheals.forEach((whl, whli) => {
            if (whli > 0) {
                setTimeout(() => {
                    dataOpt.willHeals = undefined;
                    this.heal(whl, dataOpt);
                    if (whli == willheals.length - 1) this.players[cidx].canAction = true;
                    emit(dataOpt, 'doCmd--heal-r' + whli);
                }, 1900 * whli);
            } else {
                this.heal(whl, dataOpt);
            }
        });
    }
    completeTask(dataOpt) {
        // this.taskQueueVal.step = -1;
        // this.taskQueueVal.queue.shift();
        // this.notOnlyTaskUpdate = true;
        // dataOpt.taskQueueVal = this.taskQueueVal;
    }
    isWin(dataOpt, emit) {
        let winnerIdx = -1;
        this.players.forEach((p, i) => {
            if (p.heros.every(h => h.hp <= 0)) winnerIdx = i ^ 1;
        });
        if (winnerIdx > -1) {
            setTimeout(() => this.gameEnd(winnerIdx, dataOpt, emit), 2500);
        }
        return winnerIdx;
    }
    giveup(cidx, dataOpt, emit) {
        dataOpt.winnerIdx = cidx ^ 1;
        emit(dataOpt, 'giveup');
        setTimeout(() => this.gameEnd(cidx ^ 1, dataOpt, emit), 100);
    }
    gameEnd(winnerIdx, dataOpt, emit) {
        this.players.forEach((p, i) => {
            p.info = '';
            p.phase = Player.PHASE.NOT_READY;
            p.status = Player.STATUS.WAITING;
            if (i != winnerIdx) {
                p.heros.forEach(h => h.isFront = false);
            }
        });
        this.isStart = false;
        this.phase = 0;
        clearInterval(this.countdown.timer);
        this.countdown.timer = null;
        this.countdown.curr = 0;
        emit(dataOpt, 'game-end');
    }
    startTimer(dataOpt) {
        if (this.countdown.limit <= 0) return;
        if (this.countdown.timer != null) clearInterval(this.countdown.timer);
        this.countdown.curr = this.countdown.limit;
        this.countdown.timer = setInterval(() => {
            --this.countdown.curr;
            if (this.countdown.curr <= 0 || this.phase != Player.PHASE.ACTION) {
                this.countdown.curr = 0;
                clearInterval(this.countdown.timer);
                this.countdown.timer = null;
            }
        }, 1000);
        dataOpt.startTimer = true;
    }
    _logHerosInfo() {
        for (let i = 0; i < 2; ++i) {
            const player = this.players[i];
            const heros = player.heros.map(h => {
                const inStatus = h.inStatus.map(ist => `${ist.name}`).join(',');
                const outStatus = h.outStatus.map(ost => `${ost.name}`).join(',');
                return `[${h.name}:${h.hp}hp;${h.energy}e;角色状态:${inStatus};出战状态:${outStatus}]`;
            }).join(';');
            this.log.push(`[${player.name}]${heros}`);
        }
    }
    _clearObjAttr(dataOpt, excludes = []) {
        const aexcludes = ['cidx', 'actionAfter'].concat(...excludes);
        for (const k of Object.keys(dataOpt)) {
            if (aexcludes.includes(k)) continue;
            delete dataOpt[k];
        }
    }
    _delay(time = 0) {
        if (time == 0) return;
        return new Promise(resolve => {
            setTimeout(resolve, time);
        });
    }
    async _wait(cdt, options = {}) {
        const { delay = 2000, freq = 200, maxtime = 8000, isImmediate = true } = options;
        let loop = 0;
        if (cdt() && isImmediate) return;
        while (true) {
            ++loop;
            await this._delay(freq);
            if (cdt()) {
                await this._delay(delay);
                break;
            }
            if (loop > maxtime / freq) {
                console.error('too many loops: ' + cdt.toString());
                break;
            }
        }
    }
}

class Player {
    static STATUS = {
        WAITING: 0,
        PLAYING: 1,
    }
    static PHASE = {
        NOT_READY: 0,
        NOT_BEGIN: 1,
        CHANGE_CARD: 2,
        CHOOSE_HERO: 3,
        DICE: 4,
        ACTION_START: 5,
        ACTION: 6,
        ACTION_END: 7,
        PHASE_END: 8,
        DIE_CHANGE_ACTION: 9,
        DIE_CHANGE_ACTION_END: 10,
    }
}

const SKILL_TYPE = ['', '普通攻击', '元素战技', '元素爆发', '被动技能'];

