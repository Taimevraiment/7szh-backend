
export class GeniusInvokationGame {
    constructor(id, name, password) {
        this.id = id; // 房间id
        this.name = name || `房间${id}`; // 房间名
        this.password = password; // 房间密码
        this.players = []; // 玩家数组
        this.cpidx = 0; // 当前回合玩家 currentPlayerIdx
        this.isStart = false; // 是否开始游戏
        this.phase = 0; // 阶段
        this.round = 1; // 回合数
        this.startIdx = -1; // 先手玩家
        this.onlinePlayersCnt = 0; // 在线玩家数
        this.leastPlayerCnt = 2; // 最少游戏人数
        this.mostPlayerCnt = 2; // 最多游戏人数
        this.log = []; // 当局游戏的日志
        this.SKILL_TYPE = ['', '普通攻击', '元素战技', '元素爆发', '被动技能'];
        this.isDispatchingCard = false; // 是否正在进行发牌动画
        this.resetOnly = 0; // 达到2进行统一重置
        this.taskQueueVal = { queue: [], isEndAtk: true, isExecuting: false, statusAtk: 0 }; // 任务队列
    }
    init(newPlayer, io) {
        const pidx = this.players.length;
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
            status: Player.STATUS.WAITING,
            phase: Player.PHASE.NOT_READY,
            info: '', // 右上角提示信息
            willGetCard: [],
            pidx,
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
            },
            isOffline: false,
        };
        this.players.push(player);
        this.onlinePlayersCnt = this.players.length % 3;
        this.round = 1;
        this.isDispatchingCard = false;
        this.resetOnly = 0;
        console.info(`init-rid:${this.id}-pid:${newPlayer.id}`);
        return player;
    }
    start() {
        this.isStart = true;
        this.currentPlayerIdx = Math.floor(Math.random() * 2);
        this.startIdx = this.currentPlayerIdx;
        this.phase = Player.PHASE.CHANGE_CARD;
        this.players.forEach(p => {
            p.phase = this.phase;
            p.playerInfo.weaponTypeCnt = new Set(p.pile.filter(c => c.subType.includes(0))).size;
            p.playerInfo.weaponCnt = p.pile.filter(c => c.subType.includes(0)).length;
            p.playerInfo.artifactTypeCnt = new Set(p.pile.filter(c => c.subType.includes(1))).size;
            p.playerInfo.artifactCnt = p.pile.filter(c => c.subType.includes(1)).length;
            p.playerInfo.talentTypeCnt = new Set(p.pile.filter(c => c.subType.includes(6))).size;
            p.playerInfo.talentCnt = p.pile.filter(c => c.subType.includes(6)).length;
            for (let i = 0; i < 3; ++i) p.pile.sort(() => Math.random() - 0.5);
            for (let i = 0; i < 4; ++i) {
                const subtype8Idx = p.pile.findIndex((c, ci) => ci >= i && c.subType.includes(8));
                if (subtype8Idx == -1) break;
                [p.pile[i], p.pile[subtype8Idx]] = [p.pile[subtype8Idx], p.pile[i]];
            }
            p.handCards = [...p.pile.splice(0, 5)];
            p.info = `${this.startIdx == p.pidx ? '我方' : '对方'}先手`;
            let log = `[${p.name}]获得手牌`;
            p.handCards.forEach(c => log += `[${c.name}]`);
            this.log.push(log);
        });
        console.info('start');
    }
    async infoHandle(data, io) {
        let emitFlag = 'getPlayer';
        const dataOpt = { isSendActionInfo: false };
        const emit = (option = {}, flag = '', isSend = true) => {
            const rdata = {
                ...option,
                players: this.players,
                phase: this.phase,
                round: this.round,
                startIdx: this.startIdx,
                execIdx: this.players[0].isOffline ? 1 : 0,
                log: this.log,
                gameType: 2,
                flag: dataOpt.flag ?? flag,
            };
            console.info('server:', flag);
            if (!data) rdata.taskQueueVal = this.taskQueueVal;
            if (isSend) io.to(`7szh-${this.id}`).emit(data ? 'getServerInfo' : 'roomInfoUpdate', rdata);
            return data;
        }
        if (data) {
            const { phase, cpidx, did, heros, eheros, cards, cidxs, hidx, dices, currCard, roundPhase, reconcile,
                handCards, currSkill, endPhase, summonee, currSummon, currSite, site,
                willDamage, willAttachs, dmgElements, inStatus, outStatus, esummon, cardres, siteres,
                isEndAtk, statusId, dieChangeBack, isQuickAction, willHeals, slotres, playerInfo,
                currStatus, statuscmd, hidxs, resetOnly, cmds, elTips, updateToServerOnly, isUseSkill,
                taskVal, isChangeHero, sites, skillcmds, smncmds, tarhidx, etarhidx, edices, changeFrom, flag } = data;
            emitFlag = flag ?? 'roomInfoUpdate';
            console.info('flag:', emitFlag);
            if (taskVal || emitFlag === 'roomInfoUpdate') {
                if (taskVal) this.taskQueueVal = { ...taskVal };
                dataOpt.taskQueueVal = this.taskQueueVal;
                emit(dataOpt, 'update-taskQueue');
                if (taskVal) return;
            }
            const cidx = cpidx ?? this.currentPlayerIdx;
            dataOpt.cidx = cidx;
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
            if (changeFrom != undefined) dataOpt.changeFrom = changeFrom;
            if ((currSkill?.type ?? -1) > 0 || isUseSkill) dataOpt.isUseSkill = true;
            if (resetOnly || updateToServerOnly) {
                if (++this.resetOnly < 2 || updateToServerOnly) return;
                this.resetOnly = 0;
                if (resetOnly) dataOpt.resetOnly = true;
                return emit(dataOpt, 'reset');
            }
            this.changeCard(cidxs, cidx, dataOpt, emit); // 换牌
            if (isEndAtk != undefined) dataOpt.isEndAtk = isEndAtk;
            this.modifyHero(hidx, inStatus, outStatus, cidx, isChangeHero, dieChangeBack, isQuickAction, isEndAtk, dataOpt, emit); // 改变角色状态
            this.doDice(dices, cidx, dataOpt, emit); // 掷骰子
            await this.startPhaseEnd(dataOpt, emit); // 开始阶段结束
            if (handCards != undefined) this.players[cidx].handCards = [...handCards];
            if (willDamage == undefined && esummon != undefined) this.players[cidx ^ 1].summon = [...esummon];
            await this.useCard(currCard, reconcile, cardres, cidx, hidxs, dataOpt, emit); // 出牌
            if (currSummon == undefined || !currSummon.isSelected && summonee == undefined && currSummon?.damage > 0) { // 受伤
                const isSwitch = [...(cmds ?? []), ...(smncmds ?? []), ...((skillcmds ?? [])?.[0] ?? [])].some(v => v.cmd.includes('switch') && !v.cmd.includes('self'));
                this.getDamage(willDamage, willAttachs, cidx, esummon, statusId, currSkill, isEndAtk,
                    dmgElements, currSummon, currStatus, isSwitch, dataOpt, emit);
            }
            if (cmds) await this.doCmd(cmds, cidx, dataOpt, emit);
            if (elTips) dataOpt.elTips = elTips;
            await this.doSlot(slotres, cidx, isEndAtk, dataOpt, emit);
            this.heal(willHeals, dataOpt); // 回血
            this.useSkill(currSkill, cidx, skillcmds, isEndAtk, tarhidx, etarhidx, dataOpt, emit); // 使用技能
            if (this.players.every(p => p.phase == Player.PHASE.NOT_BEGIN)) { // 两人都已准备
                this.start();
            }
            if (this.players.every(p => p.phase == Player.PHASE.DICE)) { // 两人都选完出战角色
                this.phase = Player.PHASE.DICE;
            }
            this.endPhase(endPhase, cidx, isEndAtk, dataOpt, emit); // 结束回合
            if (this.phase == Player.PHASE.ACTION_END && (currSummon || currSite || currStatus)) { // 结束阶段召唤物、场地、状态发动
                this.players[cidx].status = Player.STATUS.PLAYING;
                this.players[cidx ^ 1].status = Player.STATUS.WAITING;
            }
            await this.doStatus(currStatus, statuscmd, cidx, hidx, isEndAtk, dataOpt, emit); // 角色状态发动
            this.doSummon(currSummon, cidx, summonee, outStatus, smncmds, isEndAtk, dataOpt, emit, flag); // 召唤物行动
            await this.doSite(currSite, cidx, site, siteres, isEndAtk, dataOpt, emit, flag); // 场地效果发动
            if (this.players.every(p => p.phase == Player.PHASE.ACTION_END) && this.phase == Player.PHASE.ACTION) { // 两人都结束当前回合
                this.phase = Player.PHASE.ACTION_END;
                console.info('action-end');
            }
            this.endPhaseEnd(); // 结束阶段结束
        }
        // console.info('emit:', emit(dataOpt, '', false));
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
        while (cidxs.length > 0) {
            const cardidx = cidxs.shift();
            const ranIdx = Math.floor(Math.random() * player.pile.length);
            [player.handCards[cardidx], player.pile[ranIdx]] =
                [player.pile[ranIdx], player.handCards[cardidx]];
        }
        let log = `[${player.name}]换牌后手牌为`;
        player.handCards.forEach(c => log += `[${c.name}]`);
        this.log.push(log);
        player.info = `${this.startIdx == player.pidx ? '我方' : '对方'}先手，等待对方选择......`;
        if (this.phase == Player.PHASE.ACTION) {
            setTimeout(() => {
                this.players[cidx].phase = Player.PHASE.ACTION;
                emit(dataOpt, 'changeCard-action');
            }, 800);
        } else {
            setTimeout(() => {
                player.phase = Player.PHASE.CHOOSE_HERO;
                emit(dataOpt, 'changeCard');
            }, 800);
        }
    }
    modifyHero(hidx, inStatus, outStatus, cidx, isChangeHero, dieChangeBack, isQuickAction, isEndAtk, dataOpt, emit) { // 改变角色状态
        if (hidx == undefined) return;
        if (isChangeHero) {
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
                if (dieChangeBack) { // 阵亡后选择出战角色
                    dataOpt.dieChangeBack = this.phase;
                    this.players[cidx].heros[ohidx].inStatus = this.players[cidx].heros[ohidx].inStatus.filter(ist => ist.type.includes(12));
                    this.players[cidx].phase -= 3;
                    const isOppoActioning = this.players[cidx ^ 1].phase == Player.PHASE.ACTION;
                    this.players[cidx].info = isOppoActioning ? '对方行动中....' : '';
                    const isActioning = this.players[cidx].phase == Player.PHASE.ACTION;
                    this.players[cidx ^ 1].info = isActioning ? '对方行动中....' : '对方结束已结束回合...';
                    if (isOppoActioning) this.players[this.currentPlayerIdx].canAction = true;
                }
                this.changeTurn(cidx, isEndAtk, isQuickAction, dieChangeBack, 'changeHero', dataOpt, emit);
                dataOpt.isSendActionInfo = 1000;
                if (this.players?.[cidx]?.heros?.[hidx] == undefined) {
                    console.error(`ERR_INFO: cidx:${cidx},hidx:${hidx}`);
                }
                this.log.push(`[${this.players[cidx].name}]切换为[${this.players[cidx].heros[hidx].name}]出战${isQuickAction ? '(快速行动)' : ''}`);
            }
        } else if (inStatus || outStatus) {
            if (inStatus) this.players[cidx].heros[hidx].inStatus = [...inStatus];
            if (outStatus) this.players[cidx].heros[hidx].outStatus = [...outStatus];
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
    startPhaseEnd(dataOpt, emit) { // 开始阶段结束
        if (this.phase == Player.PHASE.ACTION &&
            this.players[0].phase == Player.PHASE.ACTION_START
        ) {
            return new Promise(async resolve => {
                this.players.forEach(p => p.phase = Player.PHASE.ACTION);
                if (this.round > 1) await this.dispatchCard(-1, 2, [], null, [], dataOpt, emit);
                this.players[this.startIdx].status = Player.STATUS.PLAYING;
                this.players.forEach(p => {
                    if (p.pidx == this.startIdx) p.info = '';
                    else p.info = '对方行动中....';
                });
                resolve();
            });
        }
    }
    useCard(currCard, reconcile, cardres, cidx, hidxs, dataOpt, emit) { // 出牌
        if (currCard == undefined || currCard.id <= 0) return;
        return new Promise(async resolve => {
            dataOpt.isSendActionInfo = 800;
            if (reconcile) { // 调和
                this.log.push(`[${this.players[cidx].name}]进行了调和`);
            } else { // 出牌
                const usedCardIds = this.players[cidx].playerInfo.usedCardIds;
                if (!usedCardIds.includes(currCard.id)) usedCardIds.push(currCard.id);
                if (cardres && cardres?.cmds) {
                    await this.doCmd(cardres.cmds, cidx, dataOpt, emit);
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
                    if (currCard.type == 2 && currCard.subType.includes(6)) {
                        this.changeTurn(cidx, true, false, false, 'useCard', dataOpt, emit);
                    }
                } else dataOpt.actionStart = cidx;
                this.log.push(`[${this.players[cidx].name}]使用了[${currCard.name}]`);
            }
            resolve();
        });
    }
    getDamage(willDamage, willAttachs, cidx, esummon, statusId, currSkill, isEndAtk,
        dmgElements, currSummon, currStatus, isSwitch, dataOpt, emit
    ) { // 受伤
        if (willDamage == undefined) return;
        dataOpt.willAttachs = willAttachs;
        dataOpt.dmgElements = dmgElements;
        let isDie = false;
        this.players.forEach((p, pi) => {
            p.heros.forEach((h, i) => {
                if (h.hp > 0) {
                    h.hp = Math.max(0, h.hp - willDamage[i + (pi ^ 1) * 3].reduce((a, b) => a + Math.max(0, b), 0));
                    if (h.hp <= 0 && h.inStatus.every(ist => !ist.type.includes(13))) {
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
                        if (winnerIdx > -1) {
                            dataOpt.winnerIdx = winnerIdx;
                        } else if (h.isFront && !isSwitch) {
                            this.players[pi].phase += 3;
                            this.players[pi].info = '请选择出战角色...';
                            this.players[pi ^ 1].info = '等待对方选择出战角色......';
                            isDie = true;
                            setTimeout(() => {
                                h.isFront = false;
                                this._clearObjAttr(dataOpt);
                                dataOpt.heroDie = pi;
                                dataOpt.isSendActionInfo = false;
                                emit(dataOpt, 'getDamage-heroDie');
                            }, 2400);
                        }
                    }
                } else {
                    willDamage[i + (pi ^ 1) * 3] = [-1, 0];
                }
            });
        });
        dataOpt.willDamage = willDamage;
        if (esummon) this.players[cidx ^ 1].summon = [...esummon];
        const frontHero = this.players[cidx].heros[this.players[cidx].hidx];
        const eFrontHero = this.players[cidx ^ 1].heros[this.players[cidx ^ 1].hidx];
        let cspidx = cidx;
        let isQuickAction = false;
        if (statusId) { // 阵营/角色状态发动
            dataOpt.isSendActionInfo = 2000;
            if (statusId.length > 0) {
                const [stsId, stype, isOppo, ohidx = -1, isSwitchAtking, iqa] = statusId;
                isQuickAction = iqa;
                const status = ['inStatus', 'outStatus'][stype];
                cspidx = (cidx + isOppo) % 2;
                const curStatuses = (isOppo ? eFrontHero : ohidx > -1 ? this.players[cspidx].heros[stype == 0 ? ohidx : this.players[cspidx].hidx] : frontHero)[status];
                const curStatus = curStatuses.find(sts => sts.id == stsId);
                if (curStatus == undefined) {
                    throw new Error(`[${this.players[cspidx].name}][${(isOppo ? eFrontHero : ohidx > -1 ? this.players[cspidx].heros[this.players[cspidx].hidx] : frontHero).name}][${status}]:${curStatuses}`);
                }
                curStatus.isSelected = true;
                if (curStatus.useCnt == 0 && !curStatus.type.includes(15)) curStatus.type.push(15);
                this.log.push(`[${this.players[cspidx].name}][${curStatus.name}]发动`);
                setTimeout(() => {
                    let ncurStatus = this.players[cspidx].heros[this.players[cspidx].hidx][status].find(sts => sts.id == stsId) ?? curStatus;
                    ncurStatus.isSelected = false;
                    if (ncurStatus.useCnt == 0) ncurStatus.type.splice(ncurStatus.type.indexOf(15), 1);
                    this._clearObjAttr(dataOpt);
                    if (!isSwitchAtking) dataOpt.isSwitchAtking = true;
                    emit(dataOpt, `getDamage-${status}`);
                }, 2000);
            }
        }
        if (currSkill == undefined && currSummon == undefined && this.phase == Player.PHASE.ACTION && !isDie) {
            this.changeTurn(cspidx, isEndAtk, isQuickAction, false, 'getDamage-status', dataOpt, emit);
        }
        if (currStatus != undefined) this.players[cidx].canAction = true;
    }
    heal(willHeals, dataOpt) { // 回血
        if (willHeals == undefined || dataOpt.willHeals != undefined) return;
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
    async useSkill(currSkill, cidx, skillcmds, isEndAtk, tarhidx, etarhidx, dataOpt, emit) { // 使用技能
        if (currSkill == undefined || currSkill.type <= 0) return;
        const frontHero = this.players[cidx].heros[this.players[cidx].hidx];
        this.players[cidx].tarhidx = tarhidx;
        this.players[cidx ^ 1].tarhidx = etarhidx;
        this.changeTurn(cidx, isEndAtk, false, false, 'useSkill', dataOpt, emit);
        dataOpt.isSendActionInfo = 2100;
        await this.doCmd(skillcmds[0], cidx, dataOpt, emit);
        await this.doCmd(skillcmds[1], cidx ^ 1, dataOpt, emit);
        this.log.push(`[${this.players[cidx].name}][${frontHero.name}]使用了[${this.SKILL_TYPE[currSkill.type]}][${currSkill.name}]`);
    }
    changeTurn(cidx, isEndAtk, isQuickAction, dieChangeBack, type, dataOpt, emit) {// 转变回合人
        const isOppoActionEnd = this.players[cidx ^ 1]?.phase >= Player.PHASE.ACTION_END;
        let canChange = false;
        this.players[cidx].canAction = false;
        let timeout = 2400;
        if (type == 'changeHero') { // 如果有速切或对方结束回合或有额外攻击则不转变回合
            canChange = isEndAtk && (!dieChangeBack && !isOppoActionEnd && !isQuickAction ||
                dieChangeBack && this.players[cidx]?.phase < Player.PHASE.ACTION_END);
            if (isOppoActionEnd) timeout = 2000;
        } else if (['useSkill', 'doSlot', 'doSummon', 'doSite', 'getDamage-status', 'useCard', 'doStatus'].includes(type)) { // 如果对方已经结束则不转变
            canChange = !isOppoActionEnd && isEndAtk && !isQuickAction;
            if (type == 'doSlot') timeout = 1300;
            else if (['doSummon', 'doStatus'].includes(type)) timeout = 0;
        }
        setTimeout(() => {
            if (canChange) {
                this.players[this.currentPlayerIdx].status = Player.STATUS.WAITING;
                ++this.currentPlayerIdx;
                this.players[this.currentPlayerIdx].status = Player.STATUS.PLAYING;
                this.players.forEach(p => {
                    if (p.pidx == this.currentPlayerIdx) p.info = '';
                    else p.info = '对方行动中....';
                });
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
        setTimeout(() => {
            this.players[this.currentPlayerIdx].status = Player.STATUS.WAITING;
            ++this.currentPlayerIdx;
            this.players[this.currentPlayerIdx].status = Player.STATUS.PLAYING;
            dataOpt.actionStart = this.currentPlayerIdx;
            dataOpt.isSendActionInfo = false;
            emit(dataOpt, 'endPhase-hasAddAtk');
        }, !isEndAtk ? 2100 : 100);
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
    doStatus(currStatus, statuscmd, cidx, hidx, isEndAtk, dataOpt, emit) { // 角色状态发动
        if (currStatus == undefined || statuscmd == undefined) return;
        return new Promise(async resolve => {
            const [cmd, type] = statuscmd;
            const status = ['inStatus', 'outStatus'][type];
            const curStatusIdx = this.players[cidx].heros[hidx][status].findIndex(sts => sts.id == currStatus.id);
            this.players[cidx].heros[hidx][status][curStatusIdx] = currStatus;
            const curStatus = this.players[cidx].heros[hidx][status][curStatusIdx];
            curStatus.isSelected = true;
            if (curStatus.useCnt == 0 && !curStatus.type.includes(15)) curStatus.type.push(15);
            const emitFlag = `do${['In', 'Out'][type]}Status-`;
            emit(dataOpt, `${emitFlag}start`);
            await this.doCmd(cmd, cidx, dataOpt, emit);
            this.log.push(`[${this.players[cidx].name}][${curStatus.name}]发动`);
            dataOpt.isSendActionInfo = 1000;
            resolve();
            setTimeout(() => {
                curStatus.isSelected = false;
                if (curStatus.useCnt == 0 && curStatus.type.indexOf(15) > -1) curStatus.type.splice(curStatus.type.indexOf(15), 1);
                dataOpt.isSendActionInfo = false;
                emit(dataOpt, `${emitFlag}end`);
                if (curStatus.type.includes(13)) this.changeTurn(cidx, isEndAtk, false, false, 'doStatus', dataOpt, emit);
            }, 1000);
        });
    }
    doSummon(currSummon, cidx, summonee, outStatus, smncmds, isEndAtk, dataOpt, emit, flag) { // 召唤物行动
        if (currSummon == undefined) return;
        const curPlayer = this.players[cidx];
        const cursummon = curPlayer.summon.find(smn => smn.id == currSummon.id);
        const step = Number(flag.slice(9, 10));
        if (summonee != undefined) {
            if (step == 3) cursummon.isSelected = false; // 边框变暗
            else if (step == 4) { // 更新summon数据
                curPlayer.summon = [...summonee];
                if (outStatus) curPlayer.heros[curPlayer.hidx].outStatus = [...outStatus];
                if (curPlayer.phase == Player.PHASE.ACTION) {
                    this.changeTurn(cidx, isEndAtk, false, false, 'doSummon', dataOpt, emit);
                }
            }
        } else {
            if (step == 1) { // 边框变亮
                cursummon.isSelected = true;
            } else if (step == 2) { // 扣血、显示伤害
                cursummon.useCnt = currSummon.useCnt;
                cursummon.element = currSummon.element;
                if (smncmds) this.doCmd(smncmds, cidx, dataOpt, emit);
                dataOpt.isSendActionInfo = 2000;
                this.log.push(`[${curPlayer.name}][${currSummon.name}]发动`);
            }
        }
    }
    doSite(currSite, cidx, site, siteres, isEndAtk, dataOpt, emit, flag) { // 场地效果发动
        if (currSite == undefined) return;
        return new Promise(async resolve => {
            if (this.phase == Player.PHASE.ACTION_END) {
                this.players[cidx].status = Player.STATUS.PLAYING;
                this.players[cidx ^ 1].status = Player.STATUS.WAITING;
            }
            const cursiteIdx = this.players[cidx].site.findIndex(st => st.sid == currSite.sid);
            const cursite = this.players[cidx].site[cursiteIdx];
            const step = Number(flag.slice(7, 8));
            if (site != undefined) {
                if (step == 3) cursite.isSelected = false; // 边框变暗
                else if (step == 4) { // 更新site数据
                    if (siteres?.isDestroy) {
                        this.players[cidx].site.splice(cursiteIdx, 1);
                    }
                    if (this.players[cidx].phase == Player.PHASE.ACTION) {
                        this.changeTurn(cidx, isEndAtk, false, false, 'doSite', dataOpt, emit);
                    }
                }
            } else {
                if (step == 1) { // 边框变亮
                    cursite.isSelected = true;
                } else if (step == 2) { // 数量、效果变化
                    if (siteres?.cmds) {
                        await this.doCmd(siteres.cmds, cidx, dataOpt, emit);
                    }
                    cursite.cnt = currSite.cnt;
                    cursite.perCnt = currSite.perCnt;
                }
            }
            resolve();
        });
    }
    doSlot(slotres, cidx, isEndAtk, dataOpt, emit) { // 装备效果发动
        if (slotres == undefined) return;
        return new Promise(async resolve => {
            const { cmds, slotIds: [hidx, slot] } = slotres;
            const subtypeList = ['weaponSlot', 'artifactSlot', '', '', '', '', 'talentSlot'];
            const curSlot = this.players[cidx].heros[hidx][subtypeList[slot.subType[0]]] = slot;
            curSlot.selected = true;
            this.log.push(`[${this.players[cidx].name}][${curSlot.name}]发动`);
            dataOpt.isSendActionInfo = 1000;
            await this.doCmd(cmds, cidx, dataOpt, emit);
            if (isEndAtk) this.players[cidx].canAction = false;
            setTimeout(() => {
                this.players[cidx].heros[hidx][subtypeList[slot.subType[0]]].selected = false;
                delete dataOpt.willHeals;
                dataOpt.isSendActionInfo = false;
                if (isEndAtk) this.changeTurn(this.currentPlayerIdx, isEndAtk, false, false, 'doSlot', dataOpt, emit);
                else emit(dataOpt, 'doSlot');
            }, 800);
            resolve();
        });
    }
    endPhaseEnd() { // 结束阶段结束
        if (this.phase != Player.PHASE.PHASE_END) return;
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
    async dispatchCard(playerIdx, cnt, subtype, gcard, hidxs, dataOpt, emit) {
        const exclude = hidxs ?? [];
        if (typeof subtype == 'number') subtype = [subtype];
        if (gcard?.length == undefined) gcard = [gcard];
        return new Promise(resolve => {
            while (cnt-- > 0) {
                this.players.forEach(p => {
                    if (p.pidx == playerIdx || playerIdx == -1) {
                        let card = null;
                        if (gcard[cnt]) {
                            card = gcard[cnt];
                        } else if (subtype.length == 0) {
                            if (p.pile.every(c => exclude.includes(c.id))) {
                                resolve();
                                return;
                            }
                            let cardIdx = p.pile.findIndex((c, i) => (i >= Math.random() * p.pile.length) && !exclude.includes(c.id));
                            if (cardIdx > -1) card = p.pile.splice(cardIdx, 1)[0];
                        } else {
                            if (p.pile.every(c => c.subType.every(st => !subtype.includes(st)))) {
                                resolve();
                                return;
                            }
                            while (card == null) {
                                const cardIdx = p.pile.findIndex((c, i) => {
                                    return (i >= Math.random() * p.pile.length) &&
                                        c.subType.some(st => subtype.includes(st)) &&
                                        !exclude.includes(c.id);
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
            resolve();
        });
    }
    doCmd(cmds, cidx, dataOpt, emit) {
        return new Promise(async resolve => {
            for (let i = 0; i < cmds.length; ++i) {
                const { cmd, cnt, hidxs, subtype = [], card = [] } = cmds[i];
                if (cmd.startsWith('getCard')) {
                    await this.dispatchCard((cidx + (cmd == 'getCard' ? 0 : 1)) % 2, cnt, subtype, card, hidxs, dataOpt, emit);
                } else if (cmd == 'heal') {
                    if (dataOpt.willHeals == undefined) dataOpt.willHeals = [-1, -1, -1, -1, -1, -1];
                    this.players[cidx].heros.forEach((h, hi) => {
                        const heal = Math.min(cnt, h.maxhp - h.hp);
                        if (h.hp > 0 && heal >= 0 && (hidxs?.includes(hi) || hidxs == undefined && h.isFront)) {
                            h.hp += heal;
                            dataOpt.willHeals[hi + (cidx ^ 1) * 3] = heal;
                        }
                    });
                } else if (cmd.startsWith('switch-')) {
                    let sdir = 0;
                    if (cmd.startsWith('switch-before')) sdir = -1;
                    else if (cmd.startsWith('switch-after')) sdir = 1;
                    const pidx = cmd.endsWith('self') ? cidx : (cidx ^ 1);
                    setTimeout(() => {
                        const heros = this.players[pidx].heros;
                        const hLen = heros.filter(h => h.hp > 0).length;
                        let nhidx = -1;
                        if (sdir == 0) {
                            nhidx = hidxs[0];
                            const livehidxs = heros.map((h, hi) => ({ hi, hp: h.hp })).filter(v => v.hp > 0).map(v => v.hi);
                            if (heros[nhidx].hp <= 0) {
                                const [[nnhidx]] = livehidxs.map(v => [v, Math.abs(v - nhidx)])
                                    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
                                nhidx = nnhidx;
                            }
                        } else {
                            nhidx = (heros.findIndex(h => h.isFront) + sdir + hLen) % hLen;
                            while (heros[nhidx].hp <= 0) nhidx = (nhidx + sdir + hLen) % hLen;
                        }
                        this._clearObjAttr(dataOpt, ['switchToSelf']);
                        this.changeHero(pidx, nhidx, dataOpt);
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
                }
            }
            resolve();
        });
    }
    isWin(dataOpt, emit) {
        let winnerIdx = -1;
        this.players.forEach((p, i) => {
            if (p.heros.every(h => h.hp <= 0)) winnerIdx = i ^ 1;
        });
        if (winnerIdx > -1) {
            setTimeout(() => {
                this.players.forEach((p, i) => {
                    p.info = '';
                    p.phase = 0;
                    if (i != winnerIdx) {
                        p.heros.forEach(h => h.isFront = false);
                    }
                });
                this.isStart = false;
                this.phase = 0;
                emit(dataOpt, 'game-end');
            }, 2500);
        }
        return winnerIdx;
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
        const aexcludes = ['cidx'].concat(...excludes);
        for (const k of Object.keys(dataOpt)) {
            if (aexcludes.includes(k)) continue;
            delete dataOpt[k];
        }
    }
    _delay(callback, time = 0) {
        return new Promise(resolve => {
            setTimeout(() => {
                if (callback) callback();
                resolve();
            }, time);
        });
    }

    get currentPlayerIdx() {
        return this.cpidx;
    }
    set currentPlayerIdx(val) {
        this.cpidx = (val + 2) % 2;
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
