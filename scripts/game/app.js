// app.js — game UI and logic refactored to use Champion objects (fighter/ranger/dragon)
(function(){
document.addEventListener('DOMContentLoaded', ()=>{
  /* ---------- config & state ---------- */
  const ROWS = 7, COLS = 7, MAX_AP = 6;
  const CHAMP_REG = { fighter: window.Fighter, ranger: window.Ranger };
  let grid = Array.from({length:ROWS}, ()=> Array(COLS).fill(null));
  let pieces = {}; // id -> Champion instance
  let setupTurn = 'ally';
  let phase = 'setup';
  let setupPlaced = { ally:[], enemy:[] };
  let selectedChampionType = 'fighter';
  let dragonId = null;

  // players
  const player = {
    ally: {hpTotal:0, hpCurrent:0, ap:3, segmentIndex:3, lastHit:null, prevSegmentIndex:3, dragonBuff:false},
    enemy:{hpTotal:0, hpCurrent:0, ap:3, segmentIndex:3, lastHit:null, prevSegmentIndex:3, dragonBuff:false}
  };

  // runtime
  let currentStepIndex = 0; // 0: ally, 1: boss, 2: enemy, 3: boss
  const cycle = ['ally','boss','enemy','boss'];
  let currentActor = null;
  let selectedId = null;
  let activeAction = null;
  let bullSpend = 1;
  let pendingRestRewards = {}; // Track pending rest rewards per piece
  
  // Strength passive state
  let strengthPending = null; // { attackerId, targetId } when Strength can be used
  
  // Ranger Focused Stance state
  let focusedRangers = { ally: null, enemy: null }; // ids of rangers with focused stance active this turn, per player

  // Dragon displacement state
  let dragonDisplacingPiece = null; // { targetId, originR, originC } when Dragon displaces a piece
  let firebreathHitTargets = []; // Track pieces hit by Firebreath for threshold removal choice

  // Universal mechanics state
  let removedChampions = { ally: [], enemy: [] }; // Track removed pieces for revival
  let pendingRemovalChoice = null; // { damageDealer, hitTargets[], shouldPromptOpponent } for multi-hit removal
  let pendingRevival = null; // { playerKey } when player can revive a champion
  
  // Lunging Strikes state
  let lungingState = null; // { fighterId, cycleCount, phase, hitTargets, strengthTargets, strengthIndex } during lunging sequence
  let lungingLocked = {}; // Track fighters locked from action after lunging: { fighterId: true }
  
  // Threshold removal choice
  let thresholdRemovalPending = null; // { playerKey, attackerId, eligibleVictims[], decider, hitThisCycle[] } when needing to choose which piece is removed
  let pausedByThresholdChoice = false; // Flag to pause lunging during threshold removal
  
  /* ---------- UI refs ---------- */
  const boardEl = document.getElementById('board');
  const btnFighter = document.getElementById('btnFighter');
  const btnRanger = document.getElementById('btnRanger');
  const finishBtn = document.getElementById('finishBtn');
  const resetBtn = document.getElementById('resetBtn');
  const phaseLabel = document.getElementById('phaseLabel');
  const setupTitle = document.getElementById('setupTitle');
  const setupHint = document.getElementById('setupHint');

  const hpAllyEl = document.getElementById('hpAlly');
  const hpEnemyEl = document.getElementById('hpEnemy');
  const hpDragonEl = document.getElementById('hpDragon');
  const apAllyEl = document.getElementById('apAlly');
  const apEnemyEl = document.getElementById('apEnemy');

  const turnLabel = document.getElementById('turnLabel');
  const selName = document.getElementById('selName');
  const selHP = document.getElementById('selHP');


  const btnMove = document.getElementById('btnMove');
  const btnPassive = document.getElementById('btnA1');
  const btnAbility = document.getElementById('btnA2');
  const btnUltimate = document.getElementById('btnA3');
  const btnFirebreath = document.getElementById('btnFirebreath');
  const btnRest = document.getElementById('btnRest');
  const btnEndTurn = document.getElementById('btnEndTurn');
  const bullInput = document.getElementById('bullInput');
  const bullSet = document.getElementById('bullSet');
  const bullBox = document.getElementById('bullBox');

  const logEl = document.getElementById('log');
  
  // Right sidebar / card display elements
  const cardTitle = document.getElementById('cardTitle');
  const cardImage = document.getElementById('cardImage');
  const cardStats = document.getElementById('cardStats');
  const cardHP = document.getElementById('cardHP');
  const cardMove = document.getElementById('cardMove');
  const cardState = document.getElementById('cardState');
  const cardAbilityList = document.getElementById('cardAbilityList');

  const strengthPrompt = document.getElementById('strengthPrompt');
  const btnStrengthYes = document.getElementById('btnStrengthYes');
  const btnStrengthNo = document.getElementById('btnStrengthNo');
  
  const revivalPrompt = document.getElementById('revivalPrompt');
  const revivalChoices = document.getElementById('revivalChoices');
  const thresholdRemovalPrompt = document.getElementById('thresholdRemovalPrompt');
  const thresholdRemovalStatus = document.getElementById('thresholdRemovalStatus');
  
  const gameOverPrompt = document.getElementById('gameOverPrompt');
  const gameOverMessage = document.getElementById('gameOverMessage');
  const btnPlayAgain = document.getElementById('btnPlayAgain');
  const btnMainMenu = document.getElementById('btnMainMenu');

  /* ---------- strength passive handlers ---------- */
  btnStrengthYes.addEventListener('click', ()=>{
    if(!strengthPending) return;
    const attacker = pieces[strengthPending.attackerId];
    const target = pieces[strengthPending.targetId];
    if(!attacker || !target){ strengthPending = null; strengthPrompt.style.display = 'none'; return; }
    if(player[attacker.player].ap < 1){ log('Not enough AP for Strength (1 AP required)'); return; }
    // Activate Strength: displace target to adjacent square
    player[attacker.player].ap -= 1;
    log(`${attacker.id} used Strength (1 AP): displacing ${target.id}...`);
    activeAction = 'strength-displace';
    highlightAdjEmpty(target.r, target.c);
    log('Strength: click an adjacent empty tile to displace the enemy.');
    strengthPrompt.style.display = 'none';
    // DO NOT set strengthPending to null here — it's needed in resolveActionOn()
  });

  btnStrengthNo.addEventListener('click', ()=>{
    strengthPending = null;
    strengthPrompt.style.display = 'none';
    log('Strength not used.');
  });

  /* ---------- game over handlers ---------- */
  btnPlayAgain.addEventListener('click', ()=>{
    restartGame();
  });

  btnMainMenu.addEventListener('click', ()=>{
    returnToMainMenu();
  });

  /* ---------- revival handlers ---------- */
  function showRevivalPrompt(playerKey){
    if(!removedChampions[playerKey] || removedChampions[playerKey].length === 0){
      log('No removed champions available for revival.');
      pendingRevival = null;
      return;
    }
    
    pendingRevival = { playerKey };
    revivalPrompt.style.display = '';
    revivalChoices.innerHTML = '';
    
    removedChampions[playerKey].forEach((championData, index) => {
      const btn = document.createElement('button');
      btn.className = 'small';
      btn.style.background = '#092532';
      btn.textContent = `Revive ${championData.id} (${championData.champion}) — HP ${championData.maxHp}`;
      btn.addEventListener('click', ()=>{
        reviveChampion(playerKey, index);
      });
      revivalChoices.appendChild(btn);
    });
  }

  function reviveChampion(playerKey, championIndex){
    const championData = removedChampions[playerKey][championIndex];
    if(!championData){
      log('Champion data not found.');
      return;
    }
    
    // Create new instance of the champion
    const Klass = CHAMP_REG[championData.champion];
    if(!Klass){
      log(`No class found for ${championData.champion}`);
      return;
    }
    
    const inst = new Klass();
    const newId = championData.id; // Reuse the old ID
    inst.id = newId;
    inst.player = playerKey;
    inst.champion = championData.champion;
    inst.rested = false;
    inst.acted = false;
    inst.cooldowns = {};
    if(inst.currentHp === undefined && inst.maxHp !== undefined) inst.currentHp = inst.maxHp;
    
    // Place on first rank
    const firstRank = playerKey === 'ally' ? 0 : ROWS - 1;
    const result = relocatePiece(newId, firstRank, Math.floor(COLS / 2), [0, 1, -1]); // Try center, then adjacent
    
    if(!result){
      // If can't place, try any empty spot on the rank
      for(let c = 0; c < COLS; c++){
        if(grid[firstRank][c] === null){
          inst.r = firstRank;
          inst.c = c;
          grid[firstRank][c] = newId;
          pieces[newId] = inst;
          setupPlaced[playerKey].push(newId);
          removedChampions[playerKey].splice(championIndex, 1);
          log(`${newId} (${championData.champion}) revived on ${playerKey === 'ally' ? 'Player 1' : 'Player 2'}'s starting row!`);
          
          revivalPrompt.style.display = 'none';
          pendingRevival = null;
          render();
          return;
        }
      }
      log('No space on starting row to revive champion.');
      return;
    }
    
    // Successfully placed
    pieces[newId] = inst;
    setupPlaced[playerKey].push(newId);
    removedChampions[playerKey].splice(championIndex, 1);
    log(`${newId} (${championData.champion}) revived on ${playerKey === 'ally' ? 'Player 1' : 'Player 2'}'s starting row!`);
    
    revivalPrompt.style.display = 'none';
    pendingRevival = null;
    render();
    
    // Check if crossing another threshold UP (multiple threshold crossings)
    checkSegmentation(playerKey);
  }

  function showThresholdRemovalPrompt(playerKey){
    thresholdRemovalPrompt.style.display = '';
    thresholdRemovalStatus.innerHTML = '';
    const playerName = playerKey === 'ally' ? 'Player 1' : 'Player 2';
    const statusDiv = document.createElement('div');
    statusDiv.style.fontSize = '12px';
    statusDiv.textContent = `${playerName}: Click on a highlighted piece to eliminate it.`;
    thresholdRemovalStatus.appendChild(statusDiv);
  }

  function hideThresholdRemovalPrompt(){
    thresholdRemovalPrompt.style.display = 'none';
    thresholdRemovalStatus.innerHTML = '';
  }

  function showGameOverPrompt(losingPlayerKey){
    const winnerName = losingPlayerKey === 'ally' ? 'Player 2' : 'Player 1';
    const loserName = losingPlayerKey === 'ally' ? 'Player 1' : 'Player 2';
    gameOverMessage.textContent = `${winnerName} wins! ${loserName} has been eliminated.`;
    gameOverPrompt.style.display = '';
    phase = 'gameover';
  }

  function checkGameLoss(playerKey){
    const aliveCount = setupPlaced[playerKey].filter(id => pieces[id]).length;
    if(aliveCount === 0){
      log(`${playerKey === 'ally' ? 'Player 1' : 'Player 2'} has been eliminated!`);
      showGameOverPrompt(playerKey);
    }
  }

  function hideGameOverPrompt(){
    gameOverPrompt.style.display = 'none';
  }

  function restartGame(){
    hideGameOverPrompt();
    // Reset all game state
    emptyGrid();
    phase = 'setup';
    setupTurn = 'ally';
    setupPlaced = { ally: [], enemy: [] };
    selectedChampionType = 'fighter';
    selectedId = null;
    activeAction = null;
    bullSpend = 1;
    pendingRestRewards = {};
    strengthPending = null;
    focusedRangerId = null;
    dragonDisplacingPiece = null;
    firebreathHitTargets = [];
    removedChampions = { ally: [], enemy: [] };
    pendingRemovalChoice = null;
    pendingRevival = null;
    lungingState = null;
    lungingLocked = {};
    thresholdRemovalPending = null;
    pausedByThresholdChoice = false;
    focusedRangers = { ally: null, enemy: null };
    currentStepIndex = 0;
    currentActor = null;
    
    // Reset player stats
    player.ally = {hpTotal: 0, hpCurrent: 0, ap: 3, segmentIndex: 3, lastHit: null, prevSegmentIndex: 3, dragonBuff: false};
    player.enemy = {hpTotal: 0, hpCurrent: 0, ap: 3, segmentIndex: 3, lastHit: null, prevSegmentIndex: 3, dragonBuff: false};
    
    renderInitial();
    log('Game restarted.');
  }

  function returnToMainMenu(){
    hideGameOverPrompt();
    window.location.href = 'index.html';
  }

  function applyDragonVictoryBuff(victoryPlayerKey){
    player[victoryPlayerKey].dragonBuff = true;
    player[victoryPlayerKey].hpCurrent = Math.min(player[victoryPlayerKey].hpTotal, player[victoryPlayerKey].hpCurrent + 3);
    player[victoryPlayerKey].ap = Math.min(MAX_AP, player[victoryPlayerKey].ap + 3);
    const playerName = victoryPlayerKey === 'ally' ? 'Player 1' : 'Player 2';
    log(`${playerName} has slain the Dragon! Gained Firebreath ability, +3 HP, and +3 AP!`);
  }

  /* ---------- helpers ---------- */
  function log(msg){ const d = document.createElement('div'); d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; logEl.prepend(d); }
  function inBounds(r,c){ return r>=0 && r<ROWS && c>=0 && c<COLS; }
  function emptyGrid(){ grid = Array.from({length:ROWS}, ()=> Array(COLS).fill(null)); pieces = {}; dragonId = null; selectedId = null; activeAction = null; }
  function hpOf(p){ return ('currentHp' in p) ? p.currentHp : (p.hp || 0); }

  // Queen-like movement: can move along rows, columns, or diagonals
  function isQueenAccessible(fromR, fromC, toR, toC, maxDist){
    const dR = toR - fromR;
    const dC = toC - fromC;
    if(dR === 0 && dC === 0) return false; // same position
    const dist = Math.max(Math.abs(dR), Math.abs(dC));
    if(dist > maxDist) return false;
    // Check if on same row, column, or diagonal
    if(dR === 0) return true; // same row
    if(dC === 0) return true; // same column
    if(Math.abs(dR) === Math.abs(dC)) return true; // diagonal
    return false;
  }

  /* ---------- render ---------- */
  function clearHighlights(){ boardEl.querySelectorAll('.cell').forEach(cell=>cell.classList.remove('move','attack','valid')); }


  function render(){
    boardEl.innerHTML = '';
    for(let r=0;r<ROWS;r++){
      for(let c=0;c<COLS;c++){
        const cell = document.createElement('div');
        cell.className = 'cell'; cell.dataset.r = r; cell.dataset.c = c;
        const pid = grid[r][c];
        if(pid){ 
          const p = pieces[pid];
          if(!p){ 
            log(`ERROR: grid[${r}][${c}] = ${pid} but pieces[${pid}] is null!`); 
            cell.classList.add('occupied'); 
          } else {
            cell.classList.add('occupied'); 
            const el = document.createElement('div'); 
            el.className = 'piece ' + (p.player === 'ally' ? 'ally' : (p.player === 'enemy' ? 'enemy' : 'boss')); 
            if(selectedId === pid) el.classList.add('selected'); 
            el.textContent = p.player==='boss' ? '🐉' : (p.champion === 'fighter' ? '⚔' : '🏹'); 
            el.title = `${pid} — ${p.player} — ${p.champion || p.name} — HP ${hpOf(p)}`; 
            if(p.rested){ const ind = document.createElement('div'); ind.className='rest-indicator'; ind.textContent='🛌'; el.appendChild(ind); } 
            if(p.focused){ const ind = document.createElement('div'); ind.className='focus-indicator'; ind.textContent='🎯'; el.appendChild(ind); } 
            cell.appendChild(el); 
          }
        }
        cell.addEventListener('click', onCellClick);
        boardEl.appendChild(cell);
      }
    }
    updateSidebar();
    updateAbilityUI();
    updateClassCard();
  }

  // Update ability UI to show only relevant buttons for selected champion
  function updateAbilityUI() {
    // Hide all by default
    btnMove.style.display = 'none';
    btnPassive.style.display = 'none';
    btnAbility.style.display = 'none';
    btnRest.style.display = 'none';
    if (btnUltimate) btnUltimate.style.display = 'none';
    if (bullBox) bullBox.style.display = 'none';

    if (!selectedId || !pieces[selectedId]) return;
    const p = pieces[selectedId];
    
    // If this piece is locked from Lunging, hide all action buttons
    if(p.lungingLocked){
      // Show a message that the piece is locked
      log(`${p.id} is locked from actions until the end of this turn.`);
      return;
    }
    
    // Move always available if not rested
    if (!p.rested) btnMove.style.display = '';
    // Show context-sensitive abilities
    if (p.champion === 'fighter') {
      btnPassive.style.display = '';
      btnPassive.textContent = 'Strike (1 AP)';
      btnAbility.style.display = '';
      btnAbility.textContent = 'Lunging Strikes (3 AP)';
      // No ultimate for fighter yet
    } else if (p.champion === 'ranger') {
      btnPassive.style.display = '';
      btnPassive.textContent = 'Focused Stance (1 AP)';
      btnAbility.style.display = '';
      btnAbility.textContent = 'Quick Shot (1 AP)';
      if (bullBox) bullBox.style.display = '';
      // Bullseye is shown separately
    } else if (p.champion === 'dragon') {
      btnPassive.style.display = '';
      btnPassive.textContent = 'Firebreath (Passive)';
      btnAbility.style.display = '';
      btnAbility.textContent = 'Strengthen (Buff)';
      if (btnUltimate) {
        btnUltimate.style.display = '';
        btnUltimate.textContent = 'Focused Assault (Ultimate)';
      }
    }
    
    // Show Firebreath button if player has the buff
    if(btnFirebreath){
      if(player[p.player].dragonBuff && p.champion !== 'dragon'){
        btnFirebreath.style.display = '';
      } else {
        btnFirebreath.style.display = 'none';
      }
    }
    
    // Rest always available if not acted or rested
    if (!p.rested && !p.acted) btnRest.style.display = '';
  }

  // Update class card display for selected piece
  function updateClassCard() {
    if (!selectedId || !pieces[selectedId]) {
      cardTitle.textContent = 'Select a piece to view details';
      cardImage.textContent = '[Class Image Placeholder]';
      cardStats.style.display = 'none';
      cardAbilityList.textContent = 'No piece selected';
      return;
    }
    
    const p = pieces[selectedId];
    const name = p.champion ? p.champion.charAt(0).toUpperCase() + p.champion.slice(1) : (p.name || '?');
    const emoji = p.player === 'boss' ? '🐉' : (p.champion === 'fighter' ? '⚔' : '🏹');
    
    cardTitle.textContent = `${emoji} ${name} (${p.id})`;
    cardImage.textContent = `[${name} Class Image]`;
    
    // Show stats
    cardStats.style.display = 'flex';
    cardHP.textContent = `${hpOf(p)} / ${p.maxHp || 20}`;
    cardMove.textContent = p.move || 1;
    const stateText = p.rested ? 'Resting' : (p.acted ? 'Acted' : 'Ready');
    cardState.textContent = stateText;
    
    // Show abilities
    let abilitiesHTML = '';
    if (p.champion === 'fighter') {
      abilitiesHTML = `
        <div style="margin-bottom:6px"><strong>Passive: Strength</strong></div>
        <div style="margin-bottom:8px">After dealing damage: spend 1 AP to displace any piece to adjacent square</div>
        <div style="margin-bottom:6px"><strong>Strike</strong> (1 AP)</div>
        <div style="margin-bottom:8px">2 dmg to adjacent piece, then can use Strength</div>
        <div style="margin-bottom:6px"><strong>Lunging Strikes</strong> (3 AP)</div>
        <div style="margin-bottom:8px">2 dmg to all adjacent, offer Strength to each (1 AP each), then 3 free moves. Locked from actions next turn.</div>
      `;
    } else if (p.champion === 'ranger') {
      abilitiesHTML = `
        <div style="margin-bottom:6px"><strong>Passive: Focused Stance</strong></div>
        <div style="margin-bottom:8px">Spend 1 AP to focus: next turn all ability ranges double. Cannot act rest of turn.</div>
        <div style="margin-bottom:6px"><strong>Quick Shot</strong> (1 AP)</div>
        <div style="margin-bottom:8px">1 dmg, range 3 (doubled if focused)</div>
        <div style="margin-bottom:6px"><strong>Bullseye</strong> (X AP)</div>
        <div style="margin-bottom:8px">2X dmg, range 3 (doubled if focused), 1 turn cooldown</div>
      `;
    } else if (p.champion === 'dragon') {
      abilitiesHTML = `
        <div style="margin-bottom:6px"><strong>Passive: Firebreath</strong></div>
        <div style="margin-bottom:8px">3 dmg to all adjacent (triggered by roll)</div>
        <div style="margin-bottom:6px"><strong>Strengthen</strong></div>
        <div style="margin-bottom:8px">Next attack deals +2 dmg</div>
        <div style="margin-bottom:6px"><strong>Focused Assault</strong> (2 AP)</div>
        <div style="margin-bottom:8px">2 dmg to all enemies, range 2</div>
      `;
    }
    cardAbilityList.innerHTML = abilitiesHTML;
  }

  function updateSidebar(){
    hpAllyEl.textContent = `${player.ally.hpCurrent} / ${player.ally.hpTotal || 0}`;
    hpEnemyEl.textContent = `${player.enemy.hpCurrent} / ${player.enemy.hpTotal || 0}`;
    apAllyEl.textContent = `${player.ally.ap}`;
    apEnemyEl.textContent = `${player.enemy.ap}`;
    
    // Display Dragon HP
    if(dragonId && pieces[dragonId]){
      const dragon = pieces[dragonId];
      hpDragonEl.textContent = `${dragon.currentHp || dragon.maxHp} / ${dragon.maxHp}`;
    } else {
      hpDragonEl.textContent = '—';
    }
    
    phaseLabel.textContent = `Phase: ${phase}`;
    turnLabel.textContent = currentActor ? `Turn: ${currentActor === 'ally' ? 'Player 1' : (currentActor === 'enemy' ? 'Player 2' : 'Dragon')}` : 'Turn: —';
    if(selectedId && pieces[selectedId]){ selName.textContent = selectedId + ' (' + (pieces[selectedId].champion||pieces[selectedId].name) + ')'; selHP.textContent = hpOf(pieces[selectedId]); }
    else { selName.textContent = '—'; selHP.textContent = '—'; }
  }

  /* ---------- setup placement ---------- */
  btnFighter.addEventListener('click', ()=>{ selectedChampionType='fighter'; btnFighter.classList.add('active'); btnRanger.classList.remove('active'); });
  btnRanger.addEventListener('click', ()=>{ selectedChampionType='ranger'; btnRanger.classList.add('active'); btnFighter.classList.remove('active'); });

  function placeForSetup(r,c){
    const validRow = setupTurn === 'ally' ? 0 : ROWS - 1;
    if(r !== validRow){ log(`Place only on row ${validRow}`); return; }
    if(grid[r][c]){ log('Cell occupied'); return; }
    if(setupPlaced[setupTurn].length >= 3){ log('Already placed 3'); return; }
    const idx = setupPlaced[setupTurn].length;
    const id = (setupTurn === 'ally' ? 'A' : 'E') + idx;
    const Klass = CHAMP_REG[selectedChampionType];
    const inst = new Klass();
    inst.id = id; inst.player = setupTurn; inst.champion = selectedChampionType; inst.rested = false; inst.acted = false; inst.cooldowns = {};
    // normalize fields to match expected names used elsewhere
    if(inst.currentHp === undefined && inst.maxHp !== undefined) inst.currentHp = inst.maxHp;
    // ensure position is set
    inst.r = r; inst.c = c;
    pieces[id] = inst; grid[r][c] = id; setupPlaced[setupTurn].push(id);
    log(`${setupTurn === 'ally' ? 'Player1' : 'Player2'} placed ${selectedChampionType} at (${r},${c})`);
    render();
    if(setupPlaced[setupTurn].length === 3) finishBtn.disabled = false;
  }

  finishBtn.addEventListener('click', ()=>{
    if(setupTurn === 'ally'){
      setupTurn = 'enemy'; setupTitle.textContent = 'Player 2 — Place 3 champions'; finishBtn.textContent = 'Finish Player 2'; finishBtn.disabled = true; btnFighter.classList.add('active'); btnRanger.classList.remove('active'); selectedChampionType='fighter'; setupHint.textContent = 'Player 2: choose and place 3 units on row 6.';
    } else {
      phase = 'inprogress'; setupTitle.textContent = 'Setup Complete'; setupHint.textContent = 'Game started! Player 1 goes first.'; finishBtn.style.display='none'; resetBtn.style.display='none'; computePools(); placeDragon(); currentStepIndex = 0; currentActor = cycle[currentStepIndex]; render(); log('Setup complete. Game begins! Player 1 (ally) goes first.');
    }
  });

  resetBtn.addEventListener('click', ()=>{
    phase='setup'; setupTurn='ally'; setupPlaced={ally:[],enemy:[]}; selectedChampionType='fighter'; btnFighter.classList.add('active'); btnRanger.classList.remove('active'); finishBtn.disabled=true; finishBtn.textContent='Finish Player 1'; setupTitle.textContent='Player 1 — Place 3 champions'; setupHint.textContent='Choose champion type then click tiles on your starting row to place.'; emptyGrid(); render(); log('Setup reset.');
  });

  function computePools(){
    const allySum = setupPlaced.ally.reduce((s,id)=> s + (hpOf(pieces[id]) || 0), 0);
    const enemySum = setupPlaced.enemy.reduce((s,id)=> s + (hpOf(pieces[id]) || 0), 0);
    player.ally.hpTotal = allySum; player.ally.hpCurrent = allySum; player.ally.ap = 3; player.ally.segmentIndex = 3; player.ally.lastHit = null;
    player.enemy.hpTotal = enemySum; player.enemy.hpCurrent = enemySum; player.enemy.ap = 3; player.enemy.segmentIndex = 3; player.enemy.lastHit = null;
  }

  function placeDragon(){
    const r = Math.floor(ROWS/2), c = Math.floor(COLS/2); 
    const id = 'B0'; 
    const boss = new window.BossDragon(); 
    boss.id = id; 
    boss.player = 'boss'; 
    boss.champion = 'dragon'; 
    boss.rested = false; 
    boss.acted = false;
    boss.cooldowns = {}; 
    boss.r = r; 
    boss.c = c;
    // ensure currentHp is set
    if(boss.currentHp === undefined && boss.maxHp !== undefined) boss.currentHp = boss.maxHp;
    pieces[id] = boss; 
    grid[r][c] = id; 
    dragonId = id; 
    log('Dragon placed at center.');
  }

  /* ---------- interactions / actions ---------- */
  function onCellClick(e){ 
    const cell = e.currentTarget; 
    const r = +cell.dataset.r, c = +cell.dataset.c; 
    if(phase === 'setup'){ placeForSetup(r,c); return; } 
    if(activeAction){ 
      log(`DEBUG: onCellClick routing to resolveActionOn for activeAction=${activeAction} at (${r},${c})`);
      resolveActionOn(r,c); 
      return; 
    } 
    const pid = grid[r][c]; 
    if(pid && pieces[pid]){ 
      const p = pieces[pid]; 
      if(currentActor === null){ log('Click End Turn to begin (Player 1 will go first).'); return; } 
      if(p.player === currentActor){ selectedId = pid; clearActionState(); render(); log(`Selected ${pid}`); } 
      else { log('You can only select pieces that belong to the current actor.'); } 
    } 
  }

  function clearActionState(){ activeAction = null; bullSpend = 1; bullInput.value = 1; clearHighlights(); focusedRangers = { ally: null, enemy: null }; }

  /* ---------- highlight helpers ---------- */
  function highlightMovesFor(id){ clearHighlights(); const p = pieces[id]; const range = (p.move !== undefined) ? p.move : 1; for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){ if(grid[r][c] === null && isQueenAccessible(p.r,p.c,r,c,range)){ const el = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`); if(el) el.classList.add('move'); } } }

  function highlightAdjEnemies(id){ clearHighlights(); const p = pieces[id]; const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]; for(const d of dirs){ const nr = p.r + d[0], nc = p.c + d[1]; if(inBounds(nr,nc) && grid[nr][nc]){ const tid = grid[nr][nc]; if(pieces[tid]){ const el = boardEl.querySelector(`.cell[data-r="${nr}"][data-c="${nc}"]`); if(el) el.classList.add('attack'); } } } }

  function highlightRanged(id, range){ clearHighlights(); const p = pieces[id]; for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){ if(isQueenAccessible(p.r,p.c,r,c,range)){ const cell = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`); if(!cell) continue; if(grid[r][c] && pieces[grid[r][c]].player !== p.player) cell.classList.add('attack'); else if(grid[r][c] === null) cell.classList.add('valid'); } } }

  function highlightAdjEmpty(r, c){ clearHighlights(); const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]; for(const d of dirs){ const nr = r + d[0], nc = c + d[1]; if(inBounds(nr,nc) && grid[nr][nc] === null){ const el = boardEl.querySelector(`.cell[data-r="${nr}"][data-c="${nc}"]`); if(el) el.classList.add('move'); } } }

  function showStrengthPrompt(attackerId, targetId){
    strengthPending = { attackerId, targetId };
    strengthPrompt.style.display = '';
    log('Strength available! Use it to displace the struck enemy? (sidebar)');
  }

  /* ---------- resolve actions ---------- */

  function resolveActionOn(r,c){
    log(`DEBUG: resolveActionOn called with r=${r}, c=${c}, activeAction=${activeAction}, selectedId=${selectedId}`);
    
    // For displacement actions, selectedId might be null (we're clicking on empty square)
    // For threshold removal, selectedId might be null (we're clicking on a piece to remove)
    // For other actions, we need a selected piece
    if(activeAction !== 'dragon-displace' && activeAction !== 'strength-displace' && activeAction !== 'threshold-removal-choice'){
      const p = pieces[selectedId];
      if(!p){ clearActionState(); return; }
    }
    
    const p = pieces[selectedId];  // May be null for displacement actions
    // MOVE
    if(activeAction === 'move'){
      const cell = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
      if(!cell.classList.contains('move')){ log('Invalid move target'); clearActionState(); return; }
      if(player[p.player].ap < 1){ log('Not enough AP for Move'); clearActionState(); return; }
      player[p.player].ap -= 1;
      p.acted = true;
      log(`${p.id} moved to (${r},${c}). AP left: ${player[p.player].ap}`);
      // move piece
      const old = {r:p.r,c:p.c}; grid[old.r][old.c] = null; p.r = r; p.c = c; grid[r][c] = p.id;
      clearActionState(); render(); return;
    }

    // STRIKE (fighter)
    if(activeAction === 'strike'){
      const cell = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
      if(!cell.classList.contains('attack')){ log('Invalid strike target'); clearActionState(); return; }
      if(player[p.player].ap < 1){ log('Not enough AP for Strike'); clearActionState(); return; }
      const tid = grid[r][c]; if(!tid){ log('No target there'); clearActionState(); return; }
      player[p.player].ap -= 1; p.acted = true;
      let dmg = 2;
      // Dragon Strengthen buff
      if(p.buff && p.buff.type === 'strength') { dmg += 2; p.buff = null; log('Strengthen buff applied!'); }
      applyDamage(p.id, tid, dmg);
      log(`${p.id} used Strike on ${tid} for ${dmg} dmg. AP left ${player[p.player].ap}`);
      // If threshold removal is pending, don't clear the action state - let the player choose
      if(thresholdRemovalPending){ return; }
      clearActionState(); render();
      // Check if target still exists and Strength can be used
      if(pieces[tid] && p.champion === 'fighter'){ showStrengthPrompt(p.id, tid); return; }
      return;
    }

    // LUNGING (fighter) - Start of 3-cycle: hit + strength offer + move
    if(activeAction === 'lunging'){
      if(player[p.player].ap < 3){ log('Not enough AP for Lunging Strikes'); clearActionState(); return; }
      player[p.player].ap -= 3;
      p.acted = true;
      p.lungingLocked = true; // Lock this fighter from action for their next turn
      
      // Initialize lunging state for 3-cycle sequence
      lungingState = { 
        fighterId: p.id, 
        cycleCount: 0, // 0, 1, 2 = up to 3 cycles
        phase: 'hit' // 'hit' -> 'strength-offer' -> 'move' -> repeat
      };
      
      log(`${p.id} used Lunging Strikes! Cycle 1 of 3...`);
      
      // Start first cycle: hit adjacent
      activeAction = 'lunging-hit';
      const adj = getAdjIds(p.r, p.c);
      let hitTargets = [];
      
      adj.forEach(tid => { 
        if(tid && pieces[tid]){ 
          applyDamage(p.id, tid, 2); 
          hitTargets.push(tid); 
        } 
      });
      
      lungingState.hitTargets = hitTargets;
      lungingState.strengthTargets = hitTargets.filter(tid => pieces[tid]); // Alive targets
      lungingState.strengthIndex = 0; // Current target for Strength offer
      
      log(`Hit ${hitTargets.length} adjacent enemies for 2 damage each.`);
      render();
      
      // Move to Strength offer phase
      if(lungingState.strengthTargets.length > 0){
        activeAction = 'lunging-strength-phase';
        const targetId = lungingState.strengthTargets[0];
        log(`Offer Strength to ${targetId}? (1 AP to displace) Or click elsewhere to skip.`);
      } else {
        activeAction = 'lunging-move-phase';
        log(`Move phase: Click an empty adjacent tile to move (1 of up to 3), or click elsewhere to skip to next cycle.`);
        highlightAdjEmpty(p.r, p.c);
      }
      return;
    }

    // LUNGING - STRENGTH PHASE (offer Strength on each hit target)
    if(activeAction === 'lunging-strength-phase'){
      if(!lungingState || lungingState.fighterId !== selectedId){
        clearActionState();
        return;
      }
      
      const targetId = lungingState.strengthTargets[lungingState.strengthIndex];
      
      // If player clicked the target, use Strength on it
      if(grid[r][c] === targetId && pieces[targetId]){
        if(player[p.player].ap < 1){
          log('Not enough AP for Strength (1 AP required)');
          return;
        }
        player[p.player].ap -= 1;
        log(`${p.id} used Strength (1 AP): displacing ${targetId}...`);
        activeAction = 'strength-displace';
        highlightAdjEmpty(pieces[targetId].r, pieces[targetId].c);
        strengthPending = { attackerId: p.id, targetId: targetId, isLungingStrength: true };
        log('Click an adjacent empty tile to displace the enemy.');
        return;
      }
      
      // Otherwise, skip Strength for this target
      lungingState.strengthIndex++;
      
      if(lungingState.strengthIndex < lungingState.strengthTargets.length){
        const nextTargetId = lungingState.strengthTargets[lungingState.strengthIndex];
        log(`Strength skipped. Next target: ${nextTargetId}? (1 AP) Or skip to move phase.`);
        return;
      }
      
      // All Strength offers done, move to move phase
      activeAction = 'lunging-move-phase';
      log(`Move phase: Click an empty adjacent tile to move (1 of up to 3), or click elsewhere to finish this cycle.`);
      clearHighlights();
      highlightAdjEmpty(p.r, p.c);
      return;
    }

    // LUNGING - MOVE PHASE (one free move per cycle)
    if(activeAction === 'lunging-move-phase'){
      if(!lungingState || lungingState.fighterId !== selectedId){
        clearActionState();
        return;
      }
      
      const cell = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
      
      if(cell && cell.classList.contains('move')){
        // Perform move
        grid[p.r][p.c] = null;
        p.r = r;
        p.c = c;
        grid[r][c] = p.id;
        
        lungingState.cycleCount++;
        log(`${p.id} moved to (${r},${c}). Cycle ${lungingState.cycleCount} complete.`);
        
        if(lungingState.cycleCount < 3){
          // More cycles available - restart the sequence
          log(`Cycle ${lungingState.cycleCount + 1} of 3...`);
          activeAction = 'lunging-hit';
          const adj = getAdjIds(p.r, p.c);
          let hitTargets = [];
          
          adj.forEach(tid => { 
            if(tid && pieces[tid]){ 
              applyDamage(p.id, tid, 2); 
              hitTargets.push(tid); 
            } 
          });
          
          lungingState.hitTargets = hitTargets;
          lungingState.strengthTargets = hitTargets.filter(tid => pieces[tid]);
          lungingState.strengthIndex = 0;
          
          log(`Hit ${hitTargets.length} adjacent enemies for 2 damage each.`);
          render();
          
          if(lungingState.strengthTargets.length > 0){
            activeAction = 'lunging-strength-phase';
            const targetId = lungingState.strengthTargets[0];
            log(`Offer Strength to ${targetId}? (1 AP to displace) Or click elsewhere to skip.`);
          } else {
            activeAction = 'lunging-move-phase';
            log(`Move phase: Click an empty adjacent tile to move, or click elsewhere to skip to next cycle.`);
            clearHighlights();
            highlightAdjEmpty(p.r, p.c);
          }
          return;
        } else {
          // 3 cycles complete
          log(`Lunging Strikes complete!`);
          lungingState = null;
          clearActionState();
          render();
          return;
        }
      }
      
      // Invalid click or intentional exit - finish lunging
      log(`Lunging Strikes complete!`);
      lungingState = null;
      clearActionState();
      render();
      return;
    }

    // QUICK (ranger)
    if(activeAction === 'quick'){
      const cell = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
      const range = pieces[selectedId].focused ? 6 : 3;
      const isValidTarget = isQueenAccessible(pieces[selectedId].r, pieces[selectedId].c, r, c, range);
      if(!isValidTarget || !cell.classList.contains('attack')){ log('Invalid Quick Shot target'); clearActionState(); return; }
      if(player[p.player].ap < 1){ log('Not enough AP for Quick Shot'); clearActionState(); return; }
      player[p.player].ap -= 1; p.acted = true; const tid = grid[r][c]; applyDamage(p.id, tid, 1); log(`${p.id} Quick Shot ${tid} for 1 dmg. AP left ${player[p.player].ap}`);
      // If threshold removal is pending, don't clear the action state - let the player choose
      if(thresholdRemovalPending){ return; }
      clearActionState(); render(); return;
    }

    // BULLSEYE (ranger)
    if(activeAction === 'bullseye'){
      const cell = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
      const range = pieces[selectedId].focused ? 6 : 3;
      const isValidTarget = isQueenAccessible(pieces[selectedId].r, pieces[selectedId].c, r, c, range);
      if(!isValidTarget || !cell.classList.contains('attack')){ log('Invalid Bullseye target'); clearActionState(); return; }
      if(player[p.player].ap < bullSpend){ log('Not enough AP for Bullseye'); clearActionState(); return; }
      p.cooldowns = p.cooldowns || {};
      if(p.cooldowns.bullseye > 0){ log('Bullseye is on cooldown!'); clearActionState(); return; }
      player[p.player].ap -= bullSpend; p.acted = true; const tid = grid[r][c]; applyDamage(p.id, tid, 2 * bullSpend); p.cooldowns.bullseye = 1; log(`${p.id} used Bullseye on ${tid} for ${2*bullSpend} dmg (spent ${bullSpend} AP, range ${range}).`);
      // If threshold removal is pending, don't clear the action state - let the player choose
      if(thresholdRemovalPending){ return; }
      clearActionState(); render(); return;
    }

    // STRENGTH DISPLACE (fighter passive)
    if(activeAction === 'strength-displace'){
      const cell = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
      if(!cell){ log('Cell not found'); return; }
      if(!cell.classList.contains('move')){ log('Invalid displacement target (must be adjacent empty tile)'); return; }
      if(!strengthPending){ log('No target to displace.'); clearActionState(); render(); return; }
      const target = pieces[strengthPending.targetId];
      if(!target){ log('Target no longer exists.'); clearActionState(); render(); return; }
      
      // Validate target is still where we think it is
      if(!inBounds(target.r, target.c) || grid[target.r][target.c] !== target.id){
        log(`ERROR: Target position mismatch. Expected (${target.r},${target.c}) but grid has ${grid[target.r]?.[target.c]}`);
        clearActionState();
        render();
        return;
      }
      
      // Validate destination is empty
      if(grid[r][c] !== null){
        log(`ERROR: Destination (${r},${c}) is not empty! Contains: ${grid[r][c]}`);
        clearActionState();
        render();
        return;
      }
      
      // Displace target
      grid[target.r][target.c] = null;
      target.r = r;
      target.c = c;
      grid[r][c] = target.id;
      log(`${strengthPending.attackerId} displaced ${target.id} to (${r},${c}).`);
      
      const wasLungingStrength = strengthPending.isLungingStrength;
      strengthPending = null;
      strengthPrompt.style.display = 'none';
      
      // If this was a Strength during Lunging, transition back to Strength offer phase for next target
      if(wasLungingStrength && lungingState){
        lungingState.strengthIndex++;
        const p = pieces[lungingState.fighterId];
        
        if(!p){
          log('ERROR: Lunging fighter no longer exists!');
          lungingState = null;
          clearActionState();
          render();
          return;
        }
        
        if(lungingState.strengthIndex < lungingState.strengthTargets.length){
          const nextTargetId = lungingState.strengthTargets[lungingState.strengthIndex];
          log(`Strength applied! Next target: ${nextTargetId}? (1 AP) Or skip to move phase.`);
          activeAction = 'lunging-strength-phase';
          clearHighlights();
          render();
          return;
        }
        
        // All Strength offers done, move to move phase
        log(`Move phase: Click an empty adjacent tile to move (1 of up to 3), or click elsewhere to finish this cycle.`);
        activeAction = 'lunging-move-phase';
        clearHighlights();
        highlightAdjEmpty(p.r, p.c);
        render();
        return;
      }
      
      // Regular Strength (not during lunging)
      clearActionState();
      render();
      return;
    }

    // THRESHOLD REMOVAL CHOICE (attacker chooses which piece to remove after hit target)
    if(activeAction === 'threshold-removal-choice'){
      if(!thresholdRemovalPending){
        clearActionState();
        render();
        return;
      }
      
      const clickedId = grid[r][c];
      
      // Check if clicked piece is eligible for removal
      if(!clickedId || !thresholdRemovalPending.eligibleVictims.includes(clickedId)){
        log('Click on an eligible piece to remove it (highlighted in red).');
        return;
      }
      
      // Check if the correct player is making this decision
      const deciderIsPlayer = thresholdRemovalPending.decider === thresholdRemovalPending.playerKey;
      const deciderIsAttacker = thresholdRemovalPending.decider === thresholdRemovalPending.attackerId;
      
      if(deciderIsPlayer){
        // Defender is choosing - they always have priority regardless of whose turn it is
        // The clicked piece should belong to the defending player
        const clickedPiece = pieces[clickedId];
        if(!clickedPiece || clickedPiece.player !== thresholdRemovalPending.playerKey){
          log('Only the defending player can choose which piece is removed.');
          return;
        }
      } else if(deciderIsAttacker){
        // Attacker is choosing
        const attacker = pieces[thresholdRemovalPending.attackerId];
        if(!attacker || currentActor !== attacker.player){
          log('Only the damage dealer can choose which piece is removed.');
          return;
        }
      }
      
      // Remove the chosen piece
      log(`${clickedId} has been removed due to threshold crossing.`);
      deletePiece(clickedId);
      
      const playerKey = thresholdRemovalPending.playerKey;
      const attackerId = thresholdRemovalPending.attackerId;
      const targetIndex = thresholdRemovalPending.targetIndex;
      const piecesToRemove = thresholdRemovalPending.piecesToRemove;
      thresholdRemovalPending = null;
      
      // Check if player is eliminated (no pieces left)
      const remainingCount = setupPlaced[playerKey].filter(id => pieces[id]).length;
      if(remainingCount === 0){
        checkGameLoss(playerKey);
        hideThresholdRemovalPrompt();
        clearActionState();
        render();
        return;
      }
      
      // Update segment to the target index (one threshold processed)
      player[playerKey].segmentIndex = targetIndex;
      
      // Clear Firebreath hit targets after threshold removal
      firebreathHitTargets = [];
      
      // After removing a piece, check if we still need to remove more for this threshold
      // We only continue prompting if we haven't removed enough pieces yet
      const remainingPiecesNeeded = targetIndex; // Minimum pieces for target segment
      const stillNeedsRemoval = remainingCount > remainingPiecesNeeded;
      
      if(stillNeedsRemoval){
        // Still need to remove another piece to reach target segment
        log(`Still need to remove ${remainingCount - remainingPiecesNeeded} more piece(s) to reach segment ${targetIndex}.`);
        hideThresholdRemovalPrompt();
        clearActionState();
        render();
        
        // Recursively prompt for removal of the next piece
        checkSegmentation(playerKey, attackerId);
      } else {
        // Done with this threshold
        log(`Threshold removal complete for segment ${targetIndex}.`);
        hideThresholdRemovalPrompt();
        clearActionState();
        render();
        
        // Check if we need to process additional thresholds due to HP drop
        const hpTotal = player[playerKey].hpTotal || 0;
        const hpSeg = Math.floor(hpTotal / 3);
        const hpCur = player[playerKey].hpCurrent;
        let actualNewIndex = 3;
        if(hpCur <= hpSeg) actualNewIndex = 1;
        else if(hpCur <= hpSeg * 2) actualNewIndex = 2;
        else actualNewIndex = 3;
        
        log(`DEBUG: After threshold removal, actual segment is ${actualNewIndex}, target was ${targetIndex}.`);
        
        // If there's still a gap between target and actual, continue processing
        if(targetIndex > actualNewIndex){
          log(`DEBUG: Additional threshold crossing needed (${targetIndex} > ${actualNewIndex}).`);
          checkSegmentation(playerKey, attackerId);
        }
      }
      return;
    }

    // DRAGON DISPLACE (Dragon movement)
    if(activeAction === 'dragon-displace'){
      log(`DEBUG: dragon-displace handler triggered. activeAction=${activeAction}`);
      // Ensure r and c are numbers
      const row = parseInt(r, 10);
      const col = parseInt(c, 10);
      log(`DEBUG: Attempting to place piece at (${row},${col})`);
      const cell = boardEl.querySelector(`.cell[data-r="${row}"][data-c="${col}"]`);
      if(!cell){ log('DEBUG: Cell not found'); return; }
      log(`DEBUG: Cell found. Has 'move' class: ${cell.classList.contains('move')}`);
      if(!cell.classList.contains('move')){ log('Invalid displacement target (must be adjacent empty tile)'); return; }
      log(`DEBUG: Cell has move class. Checking dragonDisplacingPiece...`);
      if(!dragonDisplacingPiece){ log('No piece to displace.'); clearActionState(); render(); return; }
      log(`DEBUG: dragonDisplacingPiece=${JSON.stringify(dragonDisplacingPiece)}`);
      
      // Verify the cell is actually empty
      if(grid[row][col] !== null){ 
        log(`Cell (${row},${col}) is not empty! Contains: ${grid[row][col]}`);
        return;
      }
      
      const targetId = dragonDisplacingPiece.targetId;
      const target = pieces[targetId];
      log(`DEBUG: targetId=${targetId}, target exists=${!!target}`);
      if(!target){ log('Target no longer exists.'); clearActionState(); render(); return; }
      
      // Place the piece at the chosen location
      target.r = row;
      target.c = col;
      grid[row][col] = targetId;
      log(`${targetId} placed at (${row},${col})`);
      
      // Apply damage to the displaced piece
      const boss = pieces[dragonId];
      if(boss){
        log(`Dragon applying 3 damage to ${targetId}...`);
        applyDamage(boss.id, targetId, 3);
      }
      
      dragonDisplacingPiece = null;
      clearActionState();
      render();
      
      // After placement, the auto-advance timeout will handle turn advancement
      // This ensures Dragon displacement doesn't interfere with the auto-advance flow
      return;
    }
  }

  function getAdjIds(r,c){ const out=[]; const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]; for(const d of dirs){ const nr=r+d[0], nc=c+d[1]; if(inBounds(nr,nc)) out.push(grid[nr][nc]); } return out; }

  function applyDamage(attackerId, targetId, dmg){ 
    const attacker = pieces[attackerId]; 
    const target = pieces[targetId]; 
    if(!target) return; 
    
    // Apply Desperation damage multiplier: 2x damage to Dragon when attacker is in Desperation
    if(target.player === 'boss' && attacker){
      const attackerPlayer = attacker.player;
      const playerAlive = setupPlaced[attackerPlayer].filter(id => pieces[id]).length;
      if(playerAlive === 1) dmg *= 2; // Desperation: double damage to boss
    }
    
    if(target.player === 'boss'){ 
      target.currentHp = (target.currentHp || target.maxHp) - dmg; 
      log(`${attackerId} did ${dmg} to Dragon (HP ${target.currentHp})`); 
      if(target.currentHp <= 0){ 
        log('Dragon died!'); 
        // Apply victory buff to the attacker's team
        const victoryPlayer = pieces[attackerId].player;
        applyDragonVictoryBuff(victoryPlayer);
        deletePiece(target.id); 
      } 
      return; 
    } 
    
    target.currentHp = (target.currentHp || target.maxHp) - dmg; 
    player[target.player].hpCurrent = Math.max(0, player[target.player].hpCurrent - dmg); 
    player[target.player].lastHit = attackerId; 
    
    // Clamp piece HP to minimum 0 (don't let it go negative for display purposes)
    if(target.currentHp < 0) target.currentHp = 0;
    
    log(`${attackerId} hit ${targetId} for ${dmg}. ${targetId} HP=${target.currentHp}. Owner pool ${player[target.player].hpCurrent}`); 
    
    // Only delete individual pieces if they took lethal damage AND it's a targeted attack (not AOE)
    // For AOE attacks like Firebreath, let checkSegmentation handle piece deletion via threshold crossing
    const isAOE = attackerId && pieces[attackerId] && pieces[attackerId].champion === 'dragon';
    
    if(target.currentHp <= 0 && !isAOE){ 
      log(`${targetId} died.`); 
      deletePiece(targetId); 
      player[target.player].ap = Math.min(MAX_AP, player[target.player].ap + 1); 
      log(`${target.player === 'ally' ? 'Player1' : 'Player2'} gained +1 AP (Avengement).`); 
    }
    // For AOE attacks, the piece survives at 0 HP until threshold crossing is checked
    // The threshold crossing will handle piece deletion
    
    checkSegmentation(target.player, attackerId, targetId); 
  }

  function deletePiece(id){ 
    if(!pieces[id]) return; 
    const p = pieces[id]; 
    
    // Track removed champion for potential revival
    const championData = {
      id,
      champion: p.champion,
      maxHp: p.maxHp || 20,
      player: p.player
    };
    removedChampions[p.player].push(championData);
    log(`${id} (${p.champion}) removed. Available for revival if threshold crossed.`);
    
    // Only clear grid if piece position is in bounds and points to this piece
    if(inBounds(p.r, p.c) && grid[p.r][p.c] === id) {
      grid[p.r][p.c] = null;
    }
    delete pieces[id]; 
    setupPlaced[p.player] = setupPlaced[p.player].filter(x=>x!==id); 
    if(selectedId === id) selectedId = null; 
    render(); 
  }

  function checkSegmentation(playerKey, attackerId, targetId){ 
    const total = player[playerKey].hpTotal || 0; 
    if(total === 0) return; 
    const seg = Math.floor(total / 3);
    // Thresholds are the HP values: seg (lower threshold) and seg*2 (upper threshold)
    if(player[playerKey].segmentIndex === undefined) player[playerKey].segmentIndex = 3;
    
    const cur = player[playerKey].hpCurrent;
    
    // Check if HP has reached 0 (game over condition)
    if(cur <= 0){
      log(`${playerKey === 'ally' ? 'Player 1' : 'Player 2'} HP has reached 0!`);
      checkGameLoss(playerKey);
      return;
    }
    
    let newIndex = 3; // Default to full health segment
    
    // Determine which segment the player is in based on current HP
    if(cur <= seg) newIndex = 1; // Below lower threshold
    else if(cur <= seg * 2) newIndex = 2; // Between thresholds
    else newIndex = 3; // Above upper threshold (full health)
    
    const oldIndex = player[playerKey].segmentIndex;
    log(`DEBUG checkSegmentation: ${playerKey} | total=${total} seg=${seg} cur=${cur} oldIndex=${oldIndex} newIndex=${newIndex} removed=${removedChampions[playerKey].length}`);
    
    // CROSSING DOWN: Handle one threshold crossing at a time
    if(newIndex < oldIndex){ 
      // If we're already waiting for a threshold removal choice, don't set up another one
      if(activeAction === 'threshold-removal-choice'){
        log('DEBUG: Already waiting for threshold removal choice, skipping additional check.');
        return;
      }
      
      // Process only the next immediate threshold (oldIndex - 1)
      const targetIndex = oldIndex - 1;
      const eligible = setupPlaced[playerKey].filter(id => pieces[id]);
      
      if(eligible.length === 0){
        log('No more pieces to remove.');
        player[playerKey].segmentIndex = newIndex;
        // Check if player is eliminated (no pieces left)
        checkGameLoss(playerKey);
        return;
      }
      
      // IMPORTANT: Check if piece removal is actually required
      // Segments require minimum piece counts:
      // Segment 3: 3+ pieces, Segment 2: 2+ pieces, Segment 1: 1+ piece
      const piecesRequiredForTarget = targetIndex; // targetIndex 1, 2, or 3 = required pieces
      if(eligible.length <= piecesRequiredForTarget){
        log(`DEBUG: Already at minimum pieces for segment ${targetIndex} (${eligible.length} pieces, ${piecesRequiredForTarget} required). No removal needed.`);
        player[playerKey].segmentIndex = targetIndex;
        render();
        return;
      }
      
      if(eligible.length === 1){
        // Only one piece - remove it automatically
        log(`Threshold crossed — removing piece ${eligible[0]}`);
        deletePiece(eligible[0]);
        player[playerKey].segmentIndex = targetIndex;
        
        // Check if player is eliminated (no pieces left)
        const remainingCount = setupPlaced[playerKey].filter(id => pieces[id]).length;
        if(remainingCount === 0){
          checkGameLoss(playerKey);
          return;
        }
        
        // Recursively check for next threshold
        if(targetIndex > newIndex){
          checkSegmentation(playerKey, attackerId);
        }
        return;
      }
      
      // Multiple eligible pieces
      // Calculate how many pieces need to be removed to reach targetIndex
      const piecesToRemove = eligible.length - targetIndex;
      
      if(piecesToRemove <= 0){
        // No pieces actually need to be removed to reach target segment
        log(`DEBUG: No pieces need removal to reach segment ${targetIndex} (have ${eligible.length}, need ${targetIndex})`);
        player[playerKey].segmentIndex = targetIndex;
        render();
        return;
      }
      
      log(`Threshold crossed. ${piecesToRemove} piece(s) must be removed to reach segment ${targetIndex}.`);
      
      // The hit target may already be dead (removed during applyDamage)
      // So we ask the attacker to choose which other piece gets removed
      // UNLESS the attacker is the Dragon, in which case the defender chooses
      
      const attacker = pieces[attackerId];
      const isDragonAttack = attacker && attacker.player === 'boss';
      const decider = isDragonAttack ? playerKey : attackerId;
      const deciderName = isDragonAttack ? (playerKey === 'ally' ? 'Player 1' : 'Player 2') : (attacker ? attacker.id : 'Damage dealer');
      
      // For Firebreath (AOE from Dragon), restrict choices to pieces that were actually hit
      let choicePieces = eligible;
      if(isDragonAttack && firebreathHitTargets.length > 0){
        choicePieces = eligible.filter(id => firebreathHitTargets.includes(id));
        if(choicePieces.length === 0) choicePieces = eligible; // Fallback if no hit targets match
      }
      
      log(`${deciderName}: Click on a highlighted piece to remove it (need to remove ${piecesToRemove} total).`);
      
      thresholdRemovalPending = {
        playerKey,
        attackerId: attackerId,
        eligibleVictims: choicePieces,
        decider: decider,
        targetIndex: targetIndex,
        finalIndex: newIndex,
        piecesToRemove: piecesToRemove
      };
      
      activeAction = 'threshold-removal-choice';
      render();
      
      // Show the threshold removal prompt to make it clear what the player needs to do
      showThresholdRemovalPrompt(playerKey);
      
      clearHighlights();
      log(`DEBUG: Highlighting choicePieces: ${JSON.stringify(choicePieces)}`);
      choicePieces.forEach(id => {
        const p = pieces[id];
        if(inBounds(p.r, p.c)){
          const cell = boardEl.querySelector(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
          if(cell) cell.classList.add('attack');
        }
      });
    }
    
    // CROSSING UP: Enable revival if moving to a HIGHER segment
    if(newIndex > oldIndex){
      log(`DEBUG: Crossing UP detected! oldIndex=${oldIndex} newIndex=${newIndex}`);
      // Check if we crossed any thresholds going up
      // Threshold 1: seg (e.g., 4 HP)
      // Threshold 2: seg*2 (e.g., 8 HP)
      
      // Did we cross the lower threshold (seg)?
      const crossedLower = oldIndex < 2 && newIndex >= 2; // Going from segment 1 to 2+
      // Did we cross the upper threshold (seg*2)?
      const crossedUpper = oldIndex < 3 && newIndex >= 3; // Going from segment 1-2 to 3
      
      log(`DEBUG: crossedLower=${crossedLower} crossedUpper=${crossedUpper} removed.length=${removedChampions[playerKey].length}`);
      
      // Offer revival for each threshold crossed
      if(crossedLower && removedChampions[playerKey].length > 0){
        log(`${playerKey === 'ally' ? 'Player 1' : 'Player 2'} crossed threshold upward! Champion revival available.`);
        showRevivalPrompt(playerKey);
        log(`DEBUG: Called showRevivalPrompt, pendingRevival now = ${JSON.stringify(pendingRevival)}`);
        // Update to segment 2 (crossed lower threshold)
        player[playerKey].segmentIndex = 2;
        return;
      }
      if(!crossedLower && crossedLower === false){
        log(`DEBUG: crossedLower is false, skipping lower threshold revival`);
      }
      if(removedChampions[playerKey].length === 0){
        log(`DEBUG: No removed champions available for revival`);
      }
      
      if(crossedUpper && removedChampions[playerKey].length > 0){
        log(`${playerKey === 'ally' ? 'Player 1' : 'Player 2'} crossed threshold upward! Champion revival available.`);
        showRevivalPrompt(playerKey);
        // Update to segment 3 (crossed upper threshold)
        player[playerKey].segmentIndex = 3;
        return;
      }
      
      // If no revivals available, update to new segment
      player[playerKey].segmentIndex = newIndex;
      return;
    }
    
    // No crossing - update segment if needed
    player[playerKey].segmentIndex = newIndex;
    
    // Check for Desperation: 1 champion remaining
    const aliveCount = setupPlaced[playerKey].filter(id => pieces[id]).length;
    if(aliveCount === 1){
      log(`${playerKey === 'ally' ? 'Player 1' : 'Player 2'} is now in DESPERATION! +1 AP/turn, 2x damage to boss.`);
    }
  }

  /* ---------- ui action bindings ---------- */
  btnMove.addEventListener('click', ()=>{
    if(!selectedId || !pieces[selectedId]){ log('Select a piece first'); return; }
    const p = pieces[selectedId]; if(p.player !== currentActor){ log('You can only control pieces on your turn'); return; } if(player[p.player].ap < 1){ log('Not enough AP to move'); return; } if(p.rested){ log('This piece is rested and cannot act this turn'); return; } activeAction = 'move'; highlightMovesFor(selectedId); log('Move: click highlighted tile to move.');
  });


  // Passive/Ability/Ultimate event handlers (context-sensitive)
  btnPassive.addEventListener('click', ()=>{
    if(!selectedId){ log('Select a piece first'); return; }
    const p = pieces[selectedId];
    if(p.player !== currentActor){ log('Not current actor piece'); return; }
    if(p.rested){ log('This piece is rested'); return; }
    if(p.champion === 'fighter'){
      // Strike: 1 AP, 2 dmg to adjacent enemy
      if(player[p.player].ap < 1){ log('Not enough AP for Strike'); return; }
      activeAction = 'strike';
      highlightAdjEnemies(selectedId);
      log('Strike: click adjacent enemy to hit (2 dmg)');
    } else if(p.champion === 'ranger'){
      // Focused Stance: 1 AP, doubles next turn's ability ranges, can't act rest of turn
      if(player[p.player].ap < 1){ log('Not enough AP for Focused Stance'); return; }
      player[p.player].ap -= 1;
      p.acted = true;
      p.focused = true;
      focusedRangers[p.player] = p.id;
      log(`${p.id} used Focused Stance (1 AP). Next turn all ability ranges will be doubled!`);
      clearActionState();
      render();
    } else if(p.champion === 'dragon'){
      // Firebreath: passive, 3 dmg to all adjacent enemies (no AP cost, only on dragon's turn)
      if(currentActor !== 'boss'){ log('Only the Dragon can use this on its turn.'); return; }
      const adj = getAdjIds(p.r,p.c);
      let hit = false;
      adj.forEach(tid => { if(tid && pieces[tid] && pieces[tid].player !== 'boss'){ applyDamage(p.id, tid, 3); hit = true; } });
      if(hit) log('Dragon used Firebreath (3 dmg to all adjacent)');
      else log('No adjacent enemies for Firebreath.');
      p.acted = true;
      clearActionState();
      render();
    }
  });

  btnAbility.addEventListener('click', ()=>{
    if(!selectedId){ log('Select a piece first'); return; }
    const p = pieces[selectedId];
    if(p.player !== currentActor){ log('Not current actor piece'); return; }
    if(p.rested){ log('This piece is rested'); return; }
    if(p.champion === 'fighter'){
      // Lunging Strikes: 3 AP, 2 dmg to all adjacent, then Strength offers, then 3 free moves
      if(player[p.player].ap < 3){ log('Not enough AP for Lunging Strikes'); return; }
      activeAction = 'lunging';
      log('Lunging Strikes: 2 damage to all adjacent, then Strength offers, then 3 free adjacent moves. Fighter locked from actions next turn.');
    } else if(p.champion === 'ranger'){
      // Quick Shot: 1 AP, 1 dmg, range 3 or 6 if focused
      if(player[p.player].ap < 1){ log('Not enough AP for Quick Shot'); return; }
      activeAction = 'quick';
      const range = p.focused ? 6 : 3;
      highlightRanged(selectedId, range);
      log(`Quick Shot: click enemy within ${range} tiles (1 dmg)`);
    } else if(p.champion === 'dragon'){
      // Strengthen: buff self, next attack deals +2 dmg (1 turn buff)
      p.buff = { type: 'strength', turns: 1 };
      log('Dragon used Strengthen: next attack deals +2 dmg.');
      p.acted = true;
      clearActionState();
      render();
    }
  });

  if(btnUltimate){
    btnUltimate.addEventListener('click', ()=>{
      if(!selectedId){ log('Select a piece first'); return; }
      const p = pieces[selectedId];
      if(p.player !== currentActor){ log('Not current actor piece'); return; }
      if(p.rested){ log('This piece is rested'); return; }
      if(p.champion === 'dragon'){
        // Focused Assault: 2 AP, attack all enemies in range 2 for 2 dmg (ignores rest/acted)
        if(player[p.player].ap < 2){ log('Not enough AP for Focused Assault'); return; }
        player[p.player].ap -= 2;
        let hit = false;
        for(let id in pieces){
          const t = pieces[id];
          if(t.player !== 'boss' && isQueenAccessible(p.r,p.c,t.r,t.c,2)){
            applyDamage(p.id, id, 2);
            hit = true;
          }
        }
        if(hit) log('Dragon used Focused Assault (2 dmg to all enemies in range 2)');
        else log('No targets for Focused Assault.');
        p.acted = true;
        clearActionState();
        render();
      }
    });

    btnFirebreath.addEventListener('click', ()=>{
      if(!selectedId){ log('Select a piece first'); return; }
      const p = pieces[selectedId];
      if(p.player !== currentActor){ log('Not current actor piece'); return; }
      if(p.rested){ log('This piece is rested'); return; }
      if(!player[p.player].dragonBuff){ log('Your team does not have Firebreath ability'); return; }
      
      // Firebreath: 1 AP, 3 dmg to all adjacent enemies (from Dragon buff)
      if(player[p.player].ap < 1){ log('Not enough AP for Firebreath'); return; }
      player[p.player].ap -= 1;
      const adj = getAdjIds(p.r, p.c);
      let hit = false;
      const hitTargets = [];
      adj.forEach(tid => {
        if(tid && pieces[tid] && pieces[tid].player !== p.player){
          hitTargets.push(tid);
          applyDamage(p.id, tid, 3);
          hit = true;
        }
      });
      if(hit){
        log(`${p.id} used Firebreath (3 dmg to all adjacent enemies)`);
        firebreathHitTargets = hitTargets;
      } else {
        log('No adjacent enemies for Firebreath.');
      }
      p.acted = true;
      clearActionState();
      render();
    });
  }

  bullSet.addEventListener('click', ()=>{ 
    if(!selectedId){ log('Select a piece first'); return; }
    const p = pieces[selectedId];
    if(p.player !== currentActor){ log('Not current actor piece'); return; }
    if(p.rested){ log('This piece is rested'); return; }
    if(p.champion !== 'ranger'){ log('Only Rangers can use Bullseye'); return; }
    // Bullseye: spend X AP, 2X dmg, range 3 or 6 if focused, 1 turn cooldown
    bullSpend = Math.max(1, parseInt(bullInput.value,10) || 1);
    if(player[p.player].ap < bullSpend){ log('Not enough AP for Bullseye'); return; }
    p.cooldowns = p.cooldowns || {};
    if(p.cooldowns.bullseye > 0){ log('Bullseye is on cooldown!'); return; }
    activeAction = 'bullseye';
    const range = p.focused ? 6 : 3;
    highlightRanged(selectedId, range);
    log(`Bullseye prepared (spend ${bullSpend} AP, range ${range}): click enemy within ${range} tiles`);
  });

  btnRest.addEventListener('click', ()=>{
    if(!selectedId || !pieces[selectedId]){ log('Select a piece first'); return; }
    const p = pieces[selectedId];
    if(p.player !== currentActor){ log('Can only rest on your turn'); return; }
    if(p.rested){ log('This piece already rested'); return; }
    if(p.acted){ log('Cannot rest: piece has already acted this turn'); return; }
    if(p.lungingLocked){ log('This piece is locked from all actions due to Lunging Strikes'); return; }
    p.rested = true;
    // Store pending rest rewards to be applied at end of turn
    pendingRestRewards[p.id] = { ap: 1, hp: 1 };
    log(`${p.id} rested — owner will gain +1 AP & +1 HP at end of turn`);
    clearActionState();
    render();
  });

  /* ---------- boss automatic behavior ---------- */
  function bossAct(){ 
    const boss = pieces[dragonId]; 
    if(!boss) return; 
    log('Dragon rolls a d6...'); 
    const v = Math.floor(Math.random()*6)+1; 
    log(`Dragon rolled ${v}`); 
    if(v>=1 && v<=4){ 
      const map = {1:[-1,0],2:[0,1],3:[0,-1],4:[1,0]}; 
      let [dr,dc] = map[v]; 
      let moved = 0; 
      let finalR = boss.r, finalC = boss.c;
      
      // Calculate final position (move up to 3 steps)
      for(let step=0; step<3; step++){ 
        let nr = finalR + dr; 
        let nc = finalC + dc; 
        // Check bounds and reverse direction if needed
        if(!inBounds(nr,nc)){ 
          dr = -dr; 
          dc = -dc; 
          nr = finalR + dr; 
          nc = finalC + dc; 
          if(!inBounds(nr,nc)) break; // Can't move even after reversing
        }
        finalR = nr;
        finalC = nc;
        moved++;
      } 
      
      // Move dragon to final position and handle piece that was there
      if(moved > 0){
        // Save the piece that's currently at the landing square BEFORE we move the dragon there
        const targetId = grid[finalR][finalC];
        
        // Move dragon: clear old position, update dragon position, place in new position
        grid[boss.r][boss.c] = null; 
        boss.r = finalR; 
        boss.c = finalC; 
        
        // If there was a piece at the landing position, remove it from the grid (it will be placed by the player)
        if(targetId && targetId !== boss.id && pieces[targetId]){
          grid[finalR][finalC] = null;  // Clear the displaced piece from the grid
          dragonDisplacingPiece = { targetId, originR: finalR, originC: finalC };
          activeAction = 'dragon-displace';
          const target = pieces[targetId];
          const targetOwner = target.player;
          log(`Dragon displaced ${targetId}! ${targetOwner === 'ally' ? 'Player 1' : 'Player 2'}: click an adjacent empty tile to move ${targetId} to.`);
        }
        
        // Place the Dragon at the final position (after removing the displaced piece if any)
        grid[boss.r][boss.c] = boss.id;
        log(`Dragon moved ${moved} tiles to (${boss.r},${boss.c})`);
      } 
    } else if(v === 5){ 
      boss.currentHp = Math.min(20, boss.currentHp + 3); 
      log('Dragon rested for 3 HP'); 
    } else { 
      // Firebreath: 3 dmg to all adjacent enemies
      const adj = getAdjIds(boss.r,boss.c); 
      const hitTargets = [];
      adj.forEach(tid => { 
        if(tid && pieces[tid] && pieces[tid].player !== 'boss'){
          hitTargets.push(tid);
          applyDamage(boss.id, tid, 3);
        }
      });
      if(hitTargets.length > 0){
        log('Dragon used Firebreath (3 dmg to all adjacent)');
        // Store hit targets so threshold removal can restrict choices to damaged pieces
        firebreathHitTargets = hitTargets;
      } else {
        log('No adjacent enemies for Firebreath.');
      }
    } 
    // Safety check: ensure Dragon still exists before rendering
    if(!pieces[dragonId]){ 
      log('ERROR: Dragon was deleted during bossAct!'); 
    }
    render();
    
    // If there's a pending displacement, highlight adjacent empty tiles AFTER rendering
    if(activeAction === 'dragon-displace'){
      highlightAdjEmpty(pieces[dragonId].r, pieces[dragonId].c);
      
      // Auto-resolve dragon displacement: pick first available adjacent empty tile
      setTimeout(() => {
        if(activeAction === 'dragon-displace' && dragonDisplacingPiece){
          const boss = pieces[dragonId];
          const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
          for(const d of dirs){
            const nr = boss.r + d[0], nc = boss.c + d[1];
            if(inBounds(nr, nc) && grid[nr][nc] === null){
              // Found an empty adjacent tile — simulate a click on it
              const cell = boardEl.querySelector(`.cell[data-r="${nr}"][data-c="${nc}"]`);
              if(cell) {
                log(`Auto-relocating displaced piece to (${nr},${nc})`);
                cell.click();
              }
              break;
            }
          }
        }
      }, 100);
    } 
  }

  function relocatePiece(id,r,c, prefer){ 
    const piece = pieces[id];
    if(!piece) return null;
    const oldR = piece.r, oldC = piece.c;
    const order=[]; if(prefer) order.push(prefer); order.push([-1,0],[0,1],[0,-1],[1,0],[1,1],[-1,-1],[1,-1],[-1,1]); 
    for(const d of order){ 
      const nr=r+d[0], nc=c+d[1]; 
      if(inBounds(nr,nc) && grid[nr][nc] === null){ 
        grid[oldR][oldC] = null; // Clear old position
        grid[nr][nc] = id; 
        pieces[id].r = nr; 
        pieces[id].c = nc; 
        return {toR:nr,toC:nc}; 
      } 
    } 
    return null; 
  }

  /* ---------- turn flow ---------- */
  btnEndTurn.addEventListener('click', ()=>{
    if(phase === 'setup'){ if(setupPlaced.ally.length !== 3 || setupPlaced.enemy.length !== 3){ log('Both players must place 3 champions to start.'); return; } phase = 'inprogress'; currentStepIndex = 0; currentActor = cycle[currentStepIndex]; log('Game begins. Player 1 (ally) goes first.'); render(); return; }
    
    // CLEAR LUNGING LOCK: If the current actor had any pieces with lungingLocked, clear the flag now (their "locked turn" has passed)
    if(currentActor === 'ally' || currentActor === 'enemy'){
      const playerKey = currentActor;
      for(const id in pieces){
        const p = pieces[id];
        if(p.player === playerKey && p.lungingLocked){
          p.lungingLocked = false;
          log(`${id}'s Lunging Strikes lock has expired — able to act next turn.`);
        }
      }
    }
    
    // AUTO-REST: Before advancing turn, auto-rest all pieces of current player that didn't act
    if(currentActor === 'ally' || currentActor === 'enemy'){
      const playerKey = currentActor;
      for(const id in pieces){
        const p = pieces[id];
        if(p.player === playerKey && !p.acted && !p.rested){
          p.rested = true;
          pendingRestRewards[p.id] = { ap: 1, hp: 1 };
          log(`${p.id} auto-rested — owner will gain +1 AP & +1 HP`);
        }
      }
    }
    
    // Apply pending rest rewards before advancing turn
    for(const id in pendingRestRewards){
      const piece = pieces[id];
      if(piece){
        const reward = pendingRestRewards[id];
        player[piece.player].ap = Math.min(MAX_AP, player[piece.player].ap + reward.ap);
        player[piece.player].hpCurrent = Math.min(player[piece.player].hpTotal, player[piece.player].hpCurrent + reward.hp);
        log(`${id}'s rest completed — owner gained +${reward.ap} AP & +${reward.hp} HP (AP now ${player[piece.player].ap})`);
        
        // Check if this player's HP crossed a threshold (handles both down and up crossings)
        checkSegmentation(piece.player);
      }
    }
    pendingRestRewards = {};
    
    // DESPERATION: If current player has 1 champion, gain +1 AP at end of turn
    if(currentActor === 'ally' || currentActor === 'enemy'){
      const aliveCount = setupPlaced[currentActor].filter(id => pieces[id]).length;
      if(aliveCount === 1){
        player[currentActor].ap = Math.min(MAX_AP, player[currentActor].ap + 1);
        log(`${currentActor === 'ally' ? 'Player 1' : 'Player 2'} gained +1 AP (Desperation).`);
      }
    }
    
    // Don't advance the turn yet if Dragon displacement is pending
    if(activeAction === 'dragon-displace'){
      log('Cannot end turn while waiting for player to choose Dragon displacement...');
      return;
    }
    
    // Don't advance the turn yet if threshold removal choice is pending
    if(activeAction === 'threshold-removal-choice'){
      log('Cannot end turn while waiting for damage dealer to choose which piece to remove...');
      return;
    }
    
    // Don't advance the turn yet if revival is pending
    if(pendingRevival){
      log('Cannot end turn while waiting for revival choice...');
      return;
    }
    
    currentStepIndex = (currentStepIndex + 1) % cycle.length; currentActor = cycle[currentStepIndex]; log(`Turn advanced to ${currentActor === 'ally' ? 'Player 1' : (currentActor === 'enemy' ? 'Player 2' : 'Dragon')}`);
    if(currentActor === 'ally' || currentActor === 'enemy'){
      const playerKey = currentActor;
      for(const id in pieces){
        const p = pieces[id];
        if(p.player === playerKey){
          // Check if this piece is locked from Lunging Strikes (used last turn, must skip this turn)
          if(p.lungingLocked){
            p.rested = true;
            p.acted = true;
            log(`${id} is locked from action due to Lunging Strikes — skipping this turn.`);
            // Don't clear the flag yet; it will be cleared at the END of this turn
          } else {
            p.rested = false;
            p.acted = false;
          }
          // Apply focused state if this ranger was set to focus last turn
          if(focusedRangers[playerKey] === id && p.champion === 'ranger'){
            p.focused = true;
            log(`${p.id} is focused! Ability ranges are doubled this turn.`);
            focusedRangers[playerKey] = null;
          } else {
            p.focused = false;
          }
          // Decrement cooldowns (e.g., Bullseye)
          if(p.cooldowns){
            for(const key in p.cooldowns){
              if(p.cooldowns[key] > 0) p.cooldowns[key]--;
            }
          }
          // Remove expired buffs
          if(p.buff && p.buff.turns){
            p.buff.turns--;
            if(p.buff.turns <= 0) p.buff = null;
          }
          log(`${id} is ready for a new turn.`);
        }
      }
    }
    render();
    if(currentActor === 'boss'){
      setTimeout(()=>{
        bossAct();
        
        // AUTO-ADVANCE: After Dragon finishes its action, automatically advance to next turn
        // (unless there's a pending displacement, threshold removal, or revival that requires player input)
        setTimeout(()=>{
          if(activeAction === 'dragon-displace'){
            log('Dragon displacement pending — waiting for player choice...');
            return;
          }
          if(activeAction === 'threshold-removal-choice'){
            log('Threshold removal choice pending — waiting for player choice...');
            return;
          }
          if(pendingRevival){
            log('Revival pending — waiting for player choice...');
            return;
          }
          log('Dragon turn auto-advancing to next actor...');
          // Trigger end turn logic automatically
          currentStepIndex = (currentStepIndex + 1) % cycle.length;
          currentActor = cycle[currentStepIndex];
          log(`Turn advanced to ${currentActor === 'ally' ? 'Player 1' : (currentActor === 'enemy' ? 'Player 2' : 'Dragon')}`);
          
          if(currentActor === 'ally' || currentActor === 'enemy'){
            const playerKey = currentActor;
            for(const id in pieces){
              const p = pieces[id];
              if(p.player === playerKey){
                // Check if this piece is locked from Lunging Strikes (used last turn, must skip this turn)
                if(p.lungingLocked){
                  p.rested = true;
                  p.acted = true;
                  log(`${id} is locked from action due to Lunging Strikes — skipping this turn.`);
                  // Don't clear the flag yet; it will be cleared at the END of this turn
                } else {
                  p.rested = false;
                  p.acted = false;
                }
                // Apply focused state if this ranger was set to focus last turn
                if(focusedRangers[playerKey] === id && p.champion === 'ranger'){
                  p.focused = true;
                  log(`${p.id} is focused! Ability ranges are doubled this turn.`);
                  focusedRangers[playerKey] = null;
                } else {
                  p.focused = false;
                }
                // Decrement cooldowns (e.g., Bullseye)
                if(p.cooldowns){
                  for(const key in p.cooldowns){
                    if(p.cooldowns[key] > 0) p.cooldowns[key]--;
                  }
                }
                // Remove expired buffs
                if(p.buff && p.buff.turns){
                  p.buff.turns--;
                  if(p.buff.turns <= 0) p.buff = null;
                }
              }
            }
          }
          render();
        }, 100); // Small delay to ensure bossAct completes fully
      }, 450);
    }
  });

  /* ---------- utility / init ---------- */
  function renderInitial(){ emptyGrid(); render(); log('Loaded. Place champions for Player 1 then Player 2.'); finishBtn.disabled = true; }
  renderInitial();

  // helper highlight implementations used above
  function highlightMove(id){ const p = pieces[id]; if(!p) return; const range = (p.move !== undefined) ? p.move : 1; for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){ if(grid[r][c] === null && isQueenAccessible(p.r||p.y||0,p.c||p.x||0,r,c,range)){ const el = boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`); if(el) el.classList.add('move'); } } }
  function highlightAdjEnemiesShort(id){ clearHighlights(); const p = pieces[id]; const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]; for(const d of dirs){ const nr=p.r+d[0], nc=p.c+d[1]; if(inBounds(nr,nc) && grid[nr][nc] && pieces[grid[nr][nc]].player !== p.player) boardEl.querySelector(`.cell[data-r="${nr}"][data-c="${nc}"]`).classList.add('attack'); } }

  // expose debug
  // Utility: create a deep-copy snapshot of the minimal game state for AI simulations
  function snapshotState(){
    const piecesCopy = {};
    for(const id in pieces){
      const p = pieces[id];
      piecesCopy[id] = {
        id: p.id,
        player: p.player,
        champion: p.champion,
        currentHp: p.currentHp,
        maxHp: p.maxHp,
        r: p.r,
        c: p.c,
        rested: p.rested,
        acted: p.acted,
        move: p.move,
        focused: p.focused,
        lungingLocked: p.lungingLocked,
        cooldowns: JSON.parse(JSON.stringify(p.cooldowns || {})),
        buff: p.buff ? Object.assign({}, p.buff) : null
      };
    }
    // shallow copy grid and player
    const gridCopy = grid.map(row => row.slice());
    const playerCopy = { ally: Object.assign({}, player.ally), enemy: Object.assign({}, player.enemy) };
    const setupPlacedCopy = { ally: setupPlaced.ally.slice(), enemy: setupPlaced.enemy.slice() };
    // Include interactive flags so AI can detect pending UI choices
    const removedCopy = { ally: (removedChampions.ally||[]).slice(), enemy: (removedChampions.enemy||[]).slice() };
    return { pieces: piecesCopy, grid: gridCopy, player: playerCopy, setupPlaced: setupPlacedCopy, dragonId, currentActor, activeAction, pendingRevival, thresholdRemovalPending, dragonDisplacingPiece, removedChampions: removedCopy };
  }

  // Enumerate simple legal actions for a given actor on a provided state snapshot
  function enumerateActionsForState(state, actor){
    const actions = [];
    const localPieces = state.pieces;
    const localGrid = state.grid;
    const playerAp = (state.player && state.player[actor] && state.player[actor].ap) || 0;
    function inBoundsSim(r,c){ return r>=0 && r<localGrid.length && c>=0 && c<localGrid[0].length; }
    function isQueenAccessibleSim(fr,fc,tr,tc,maxDist){ const dR = tr-fr, dC = tc-fc; if(dR===0 && dC===0) return false; const dist = Math.max(Math.abs(dR), Math.abs(dC)); if(dist>maxDist) return false; if(dR===0||dC===0||Math.abs(dR)===Math.abs(dC)) return true; return false; }

    for(const id in localPieces){
      const p = localPieces[id];
      if(p.player !== actor) continue;
      if(p.rested || p.acted || p.lungingLocked) continue;
      // Move actions (cost 1 AP) - only if AP available
      if(playerAp >= 1){
        const range = (p.move !== undefined) ? p.move : 1;
        for(let r=0;r<localGrid.length;r++) for(let c=0;c<localGrid[0].length;c++){
          if(localGrid[r][c] === null && isQueenAccessibleSim(p.r,p.c,r,c,range)){
            actions.push({type:'move', actor, pieceId:id, to:{r,c}});
          }
        }
      }
      // Attack actions
      const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      if(p.champion === 'fighter'){
        // Strike actions (cost 1 AP) - only if AP available
        if(playerAp >= 1){
          for(const d of dirs){ const nr=p.r+d[0], nc=p.c+d[1]; if(inBoundsSim(nr,nc) && localGrid[nr][nc]){ const tid = localGrid[nr][nc]; if(localPieces[tid] && localPieces[tid].player !== actor){
              // no-displace strike
              actions.push({type:'strike', actor, attacker:id, target:tid});
              // displace options around the TARGET
              for(const dd of dirs){ const dr = localPieces[tid].r + dd[0], dc = localPieces[tid].c + dd[1]; if(inBoundsSim(dr,dc) && localGrid[dr][dc] === null){ actions.push({type:'strike', actor, attacker:id, target:tid, displaceTo:{r:dr,c:dc}}); } }
            } } }
        }
        // Lunging (cost 3 AP) - only if AP available
        if(playerAp >= 3){
          actions.push({type:'lunging', actor, attacker:id});
        }
      } else if(p.champion === 'ranger'){
        // quick shot (cost 1 AP) - only if AP available
        if(playerAp >= 1){
          for(let r=0;r<localGrid.length;r++) for(let c=0;c<localGrid[0].length;c++){ if(localGrid[r][c] && localPieces[localGrid[r][c]] && localPieces[localGrid[r][c]].player !== actor){ if(isQueenAccessibleSim(p.r,p.c,r,c,3)) actions.push({type:'quick', actor, attacker:id, target: localGrid[r][c]}); } }
        }
        // Bullseye actions (cost variable AP up to available)
        const maxSpend = Math.min(4, playerAp);
        if(maxSpend >= 1){
          for(let r=0;r<localGrid.length;r++) for(let c=0;c<localGrid[0].length;c++){ if(localGrid[r][c] && localPieces[localGrid[r][c]] && localPieces[localGrid[r][c]].player !== actor){ if(isQueenAccessibleSim(p.r,p.c,r,c,3)){ for(let s=1;s<=maxSpend;s++){ actions.push({type:'bullseye', actor, attacker:id, target: localGrid[r][c], spend:s}); } } } }
        }
      }
      // Rest (always available)
      actions.push({type:'rest', actor, pieceId:id});
    }
    // End turn is always a legal action
    actions.push({type:'endTurn', actor});
    return actions;
  }

  // Apply a simple action to the live game state (used by AI to execute chosen move)
  function applyActionToLive(action){
    if(!action) return false;
    try{
      if(action.type === 'move'){
        const p = pieces[action.pieceId]; if(!p) return false; if(player[p.player].ap < 1) return false; player[p.player].ap -= 1; grid[p.r][p.c] = null; p.r = action.to.r; p.c = action.to.c; grid[p.r][p.c] = p.id; p.acted = true; render(); return true;
      }
      if(action.type === 'strike'){
        const attacker = pieces[action.attacker]; const target = pieces[action.target]; if(!attacker || !target) return false; if(player[attacker.player].ap < 1) return false; player[attacker.player].ap -= 1; attacker.acted = true; applyDamage(attacker.id, target.id, 2);
        // Optional displacement
        if(action.displaceTo && pieces[target.id]){
          const dr = action.displaceTo.r, dc = action.displaceTo.c;
          if(inBounds(dr,dc) && grid[dr][dc] === null){ grid[target.r][target.c] = null; target.r = dr; target.c = dc; grid[dr][dc] = target.id; log(`${attacker.id} displaced ${target.id} to (${dr},${dc}) via Strength`); }
        }
        render(); return true;
      }
      if(action.type === 'quick'){
        const attacker = pieces[action.attacker]; const target = pieces[action.target]; if(!attacker || !target) return false; if(player[attacker.player].ap < 1) return false; player[attacker.player].ap -= 1; attacker.acted = true; applyDamage(attacker.id, target.id, 1); render(); return true;
      }
      if(action.type === 'bullseye'){
        const attacker = pieces[action.attacker]; const target = pieces[action.target]; const spend = Math.max(1, Math.min(action.spend||1, player[attacker.player].ap||0)); if(!attacker || !target) return false; if(player[attacker.player].ap < spend) return false; player[attacker.player].ap -= spend; attacker.acted = true; applyDamage(attacker.id, target.id, 2 * spend); if(attacker.cooldowns) attacker.cooldowns.bullseye = 1; render(); return true;
      }
      if(action.type === 'lunging'){
        const attacker = pieces[action.attacker]; if(!attacker) return false; if(player[attacker.player].ap < 3) return false; player[attacker.player].ap -= 3; attacker.acted = true; attacker.lungingLocked = true; // lock for next turn
        // Hit adjacent enemies for 2 dmg
        const dirsLocal = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
        const adjIds = [];
        for(const d of dirsLocal){ const nr=attacker.r+d[0], nc=attacker.c+d[1]; if(inBounds(nr,nc) && grid[nr][nc]) adjIds.push(grid[nr][nc]); }
        adjIds.forEach(tid=>{ if(pieces[tid]){ applyDamage(attacker.id, tid, 2); } });
        // Attempt auto-displace: for each hit target still alive, move to first adjacent empty
        adjIds.forEach(tid=>{ const t = pieces[tid]; if(t){ for(const d of dirsLocal){ const tr = t.r + d[0], tc = t.c + d[1]; if(inBounds(tr,tc) && grid[tr][tc] === null){ grid[t.r][t.c] = null; t.r = tr; t.c = tc; grid[tr][tc] = t.id; log(`${attacker.id} (lunging) displaced ${t.id} to (${tr},${tc})`); break; } } } });
        // Perform up to 3 free adjacent moves if possible (pick first empty each time)
        for(let move=0; move<3; move++){ let moved=false; for(const d of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){ const nr=attacker.r+d[0], nc=attacker.c+d[1]; if(inBounds(nr,nc) && grid[nr][nc] === null){ grid[attacker.r][attacker.c] = null; attacker.r = nr; attacker.c = nc; grid[nr][nc] = attacker.id; moved = true; break; } } if(!moved) break; }
        render(); return true;
      }
      if(action.type === 'rest'){
        const p = pieces[action.pieceId]; if(!p) return false; if(p.rested || p.acted) return false; p.rested = true; pendingRestRewards[p.id] = {ap:1, hp:1}; render(); return true;
      }
      if(action.type === 'endTurn'){
        btnEndTurn.click(); return true;
      }
    } catch(e){ console.warn('applyActionToLive error', e); return false; }
    return false;
  }

  // Expose AI-friendly API
  window.GameAPI = {
    snapshot: snapshotState,
    enumerateActionsForState: enumerateActionsForState,
    applyActionToLive: applyActionToLive,
    // Choose a revival option (index into removedChampions[playerKey])
    chooseRevival: function(playerKey, championIndex){
      try{
        if(!pendingRevival || !removedChampions[playerKey]) return false;
        // If revival index out of range, clamp
        const idx = Math.max(0, Math.min(championIndex|0, removedChampions[playerKey].length-1));
        reviveChampion(playerKey, idx);
        return true;
      } catch(e){ console.warn('chooseRevival error', e); return false; }
    },
    // Choose a threshold removal by piece id (simulate clicking that cell)
    chooseThresholdRemovalById: function(pieceId){
      try{
        if(!thresholdRemovalPending) return false;
        const p = pieces[pieceId]; if(!p) return false;
        const cell = boardEl.querySelector(`.cell[data-r="${p.r}"][data-c="${p.c}"]`);
        if(!cell) return false;
        cell.click();
        return true;
      } catch(e){ console.warn('chooseThresholdRemovalById error', e); return false; }
    }
  };

  window.__av2 = {pieces,grid,player,render};
});
})();
