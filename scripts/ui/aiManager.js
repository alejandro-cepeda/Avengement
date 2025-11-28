// AI Manager - Handles AI opponent configuration and execution
(() => {
  console.log('[AI Manager] Loaded - this MUST appear in console');
  // Global AI configuration
  let gameConfig = {
    p1IsAI: false,
    p2IsAI: false,
    p1Difficulty: 'medium',
    p2Difficulty: 'medium',
    iterations: 40
  };
  
  // Export for debugging
  window.gameConfig = gameConfig;

  let aiTurnInProgress = false;
  let aiCallCount = 0;
  let setupComplete = false; // Flag to indicate setup phase is complete
  let pauseAIExecution = false; // Flag to pause AI execution for human turns
  
  // Public function to pause/resume AI execution (called when human player is acting)
  window.pauseAIExecution = function(pause) {
    pauseAIExecution = pause;
    if (pause) {
      console.log('[AI] AI execution PAUSED for human player turn');
    } else {
      console.log('[AI] AI execution RESUMED');
    }
  };
  
  // Public function to reset AI state (called when game resets)
  window.resetAIState = function() {
    console.log('[AI] Resetting AI state');
    pauseAIExecution = false;
    aiTurnInProgress = false;
    aiCallCount = 0;
    setupComplete = false;
    lastTurnActor = null;
    lastTurnTime = null;
    stopStuckTurnDetection();
  };
  
  // Stuck turn detection
  let lastTurnActor = null;
  let lastTurnTime = null;
  let stuckCheckInterval = null;
  const STUCK_TIMEOUT = 5000; // 5 seconds to detect stuck turn

  // Function to check if turn is stuck and force advancement
  function startStuckTurnDetection() {
    if (stuckCheckInterval) clearInterval(stuckCheckInterval);
    
    stuckCheckInterval = setInterval(() => {
      if (!window.GameAPI) return;
      
      const phase = window.GameAPI.getPhase ? window.GameAPI.getPhase() : null;
      if (phase !== 'inprogress') return;
      
      const snapshot = window.GameAPI.snapshot();
      const currentActor = snapshot.currentActor;
      
      // Check if it's a dragon turn (AI vs AI) and it hasn't advanced
      if (currentActor === 'boss' && gameConfig.p1IsAI && gameConfig.p2IsAI) {
        if (lastTurnActor === 'boss') {
          const timeSinceLastTurn = Date.now() - lastTurnTime;
          if (timeSinceLastTurn > STUCK_TIMEOUT) {
            console.log(`[AI] Dragon turn stuck for ${timeSinceLastTurn}ms, forcing advancement`);
            const endTurnBtn = document.getElementById('btnEndTurn');
            if (endTurnBtn) {
              endTurnBtn.click();
              lastTurnActor = null;
              lastTurnTime = null;
            }
          }
        } else {
          // New dragon turn detected
          lastTurnActor = 'boss';
          lastTurnTime = Date.now();
        }
      } else {
        // Player turn or not AI vs AI, reset tracking
        lastTurnActor = currentActor;
        lastTurnTime = Date.now();
      }
    }, 1000); // Check every second
  }
  
  function stopStuckTurnDetection() {
    if (stuckCheckInterval) {
      clearInterval(stuckCheckInterval);
      stuckCheckInterval = null;
    }
  }

  // Execute AI turn if needed (called from render)
  window.executeAITurnIfNeeded = async function() {
    console.log('[AI] executeAITurnIfNeeded called');
    
    // Skip if AI execution is paused (human player's turn)
    if (pauseAIExecution) {
      console.log('[AI] AI execution paused, skipping');
      return;
    }
    
    if (!window.GameAPI) {
      console.log('[AI] GameAPI not available, returning');
      return;
    }

    const phase = window.GameAPI.getPhase ? window.GameAPI.getPhase() : null;
    console.log('[AI] phase=' + phase);
    if (phase !== 'inprogress') {
      console.log('[AI] phase is not inprogress, returning');
      return;
    }

    const snapshot = window.GameAPI.snapshot();
    const currentActor = snapshot.currentActor;
    console.log('[AI] currentActor=' + currentActor);
    
    // Boss turn is handled separately by app.js, not by AI manager
    if (!currentActor || currentActor === 'boss') {
      console.log('[AI] currentActor is null or boss, returning');
      return;
    }

    const isAI = (currentActor === 'ally') ? gameConfig.p1IsAI : gameConfig.p2IsAI;
    console.log(`[AI] ===== IS_AI_CHECK: currentActor=${currentActor}, gameConfig.p1IsAI=${gameConfig.p1IsAI}, gameConfig.p2IsAI=${gameConfig.p2IsAI}, isAI=${isAI} =====`);
    if (!isAI) {
      console.log(`[AI] Not an AI turn (isAI=${isAI}), pausing execution for human player`);
      pauseAIExecution = true;
      return;
    }
    console.log(`[AI] THIS IS AN AI TURN! currentActor=${currentActor} is AI, proceeding with AI logic`);

    if (aiTurnInProgress) {
      console.log('[AI] Turn already in progress, skipping');
      return;
    }

    aiCallCount++;
    const callNum = aiCallCount;
    console.log(`[AI #${callNum}] Starting AI turn for ${currentActor}`);

    aiTurnInProgress = true;
    const thinkingDiv = document.getElementById('aiThinking');
    if (thinkingDiv) thinkingDiv.style.display = 'block';

    try {
      const difficulty = (currentActor === 'ally') ? gameConfig.p1Difficulty : gameConfig.p2Difficulty;
      const iterations = gameConfig.iterations;

      const best = await window.findBestActionForDifficulty(iterations, currentActor, difficulty);
      
      if (!best) {
        console.log(`[AI #${callNum}] No valid action found`);
        aiTurnInProgress = false;
        if (thinkingDiv) thinkingDiv.style.display = 'none';
        return;
      }

      console.log(`[AI #${callNum}] Applying action:`, best);
      const ok = window.GameAPI.applyActionToLive(best);
      
      if (!ok) {
        console.log(`[AI #${callNum}] Action failed to apply`);
      }

      // Auto-end turn if all pieces have acted AND there are no pending actions
      const updatedSnapshot = window.GameAPI.snapshot();
      const playerPieces = Object.values(updatedSnapshot.pieces || {}).filter(p => p.player === currentActor);
      const allActed = playerPieces.every(p => p.acted || p.rested);
      
      const hasPendingActions = updatedSnapshot.activeAction || updatedSnapshot.pendingRevival || updatedSnapshot.thresholdRemovalPending || updatedSnapshot.dragonDisplacingPiece;

      if (allActed && !hasPendingActions && best.type !== 'endTurn') {
        console.log(`[AI #${callNum}] All pieces acted with no pending actions, auto-ending turn`);
        // Increased delay to 500ms to ensure dragon displacement auto-resolution completes
        setTimeout(() => {
          const endTurnBtn = document.getElementById('btnEndTurn');
          if (endTurnBtn) {
            // Double-check no pending actions before clicking
            const finalSnapshot = window.GameAPI.snapshot();
            const stillHasPending = finalSnapshot.activeAction || finalSnapshot.pendingRevival || finalSnapshot.thresholdRemovalPending || finalSnapshot.dragonDisplacingPiece;
            if (!stillHasPending) {
              endTurnBtn.click();
            } else {
              console.log(`[AI #${callNum}] Pending actions detected on final check, skipping turn end`);
            }
          }
        }, 500);
      }

    } catch (e) {
      console.error(`[AI #${callNum}] Error:`, e);
    } finally {
      aiTurnInProgress = false;
      if (thinkingDiv) thinkingDiv.style.display = 'none';
    }
  };

  // Initialize AI UI controls
  window.initializeAIControls = function() {
    console.log('[AI] ===== window.initializeAIControls CALLED =====');
    console.log('[AI] document.readyState:', document.readyState);
    console.log('[AI] Initializing controls');
    
    const setupPanel = document.getElementById('setupPanel');
    const gameStatePanel = document.getElementById('gameStatePanel');
    const btnStartGame = document.getElementById('btnStartGame');
    const btnEndGame = document.getElementById('btnEndGame');
    const setupStatus = document.getElementById('setupStatus');
    
    console.log('[AI] setupPanel found:', !!setupPanel);
    console.log('[AI] gameStatePanel found:', !!gameStatePanel);
    console.log('[AI] btnStartGame found:', !!btnStartGame);
    console.log('[AI] btnEndGame found:', !!btnEndGame);
    console.log('[AI] setupStatus found:', !!setupStatus);

    const p1Radios = document.querySelectorAll('input[name="p1Type"]');
    const p2Radios = document.querySelectorAll('input[name="p2Type"]');
    const p1DiffSelect = document.getElementById('p1Difficulty');
    const p2DiffSelect = document.getElementById('p2Difficulty');
    const iterationsInput = document.getElementById('aiIterations');

    if (!btnStartGame) {
      console.error('[AI] btnStartGame not found! CANNOT CONTINUE');
      return;
    }

    // Update difficulty selector visibility
    function updateDifficultyVisibility() {
      const p1IsAI = document.querySelector('input[name="p1Type"][value="ai"]')?.checked || false;
      const p2IsAI = document.querySelector('input[name="p2Type"][value="ai"]')?.checked || false;
      
      if (p1DiffSelect) {
        p1DiffSelect.style.opacity = p1IsAI ? '1' : '0.5';
        p1DiffSelect.style.pointerEvents = p1IsAI ? 'auto' : 'none';
      }
      if (p2DiffSelect) {
        p2DiffSelect.style.opacity = p2IsAI ? '1' : '0.5';
        p2DiffSelect.style.pointerEvents = p2IsAI ? 'auto' : 'none';
      }
      
      window.updateSetupStatus();
    }

    // Update setup status and enable/disable Start button
    window.updateSetupStatus = function() {
      if (!btnStartGame || !setupStatus) return;

      const p1IsAI = document.querySelector('input[name="p1Type"][value="ai"]')?.checked || false;
      const p2IsAI = document.querySelector('input[name="p2Type"][value="ai"]')?.checked || false;
      
      let text = '';
      if (p1IsAI) text += `P1: AI (${p1DiffSelect?.value || 'medium'}) `;
      else text += 'P1: Human ';
      text += 'vs ';
      if (p2IsAI) text += `P2: AI (${p2DiffSelect?.value || 'medium'})`;
      else text += 'P2: Human';
      
      // Check if both players have placed pieces - always check the current state
      const setupPlaced = window.__av2?.getSetupPlaced?.() || { ally: [], enemy: [] };
      const allyCount = setupPlaced?.ally?.length || 0;
      const enemyCount = setupPlaced?.enemy?.length || 0;
      const bothPlaced = allyCount === 3 && enemyCount === 3;
      
      console.log('[AI] updateSetupStatus: ally=' + allyCount + ', enemy=' + enemyCount + ', bothPlaced=' + bothPlaced + ', setupComplete=' + setupComplete);
      
      // FORCE the button state based on pieces placed OR if setup was already marked complete
      if (bothPlaced || setupComplete) {
        console.log('[AI] updateSetupStatus: ENABLING button (bothPlaced=' + bothPlaced + ', setupComplete=' + setupComplete + ')');
        btnStartGame.disabled = false;
        btnStartGame.style.opacity = '1';
        btnStartGame.style.cursor = 'pointer';
        btnStartGame.style.backgroundColor = '#0a6b3d';
        btnStartGame.style.pointerEvents = 'auto';
        btnStartGame.setAttribute('aria-disabled', 'false');
      } else {
        console.log('[AI] updateSetupStatus: DISABLING button');
        btnStartGame.disabled = true;
        btnStartGame.style.opacity = '0.5';
        btnStartGame.style.cursor = 'not-allowed';
        btnStartGame.style.backgroundColor = '';
        btnStartGame.style.pointerEvents = 'none';
        btnStartGame.setAttribute('aria-disabled', 'true');
      }
      
      setupStatus.textContent = bothPlaced || setupComplete ? text : 'Place pieces for both players first';
    };

    // Listen to radio changes
    p1Radios.forEach(r => r.addEventListener('change', updateDifficultyVisibility));
    p2Radios.forEach(r => r.addEventListener('change', updateDifficultyVisibility));
    if (p1DiffSelect) p1DiffSelect.addEventListener('change', window.updateSetupStatus);
    if (p2DiffSelect) p2DiffSelect.addEventListener('change', window.updateSetupStatus);
    
    // Initialize
    updateDifficultyVisibility();
    window.updateSetupStatus();
    
    // Note: Start Game button uses onclick attribute in HTML which calls window.handleStartGameClick()
    // We do NOT add an addEventListener here to avoid duplicate handlers and event dispatch loops
    console.log('[AI] Start Game button will use onclick attribute handler (window.handleStartGameClick)');
    
    // End Game button
    if (btnEndGame) {
      btnEndGame.addEventListener('click', () => {
        console.log('[AI] Ending game');
        
        // Stop stuck turn detection
        stopStuckTurnDetection();
        
        // Reset config
        gameConfig.p1IsAI = false;
        gameConfig.p2IsAI = false;
        gameConfig.p1Difficulty = 'medium';
        gameConfig.p2Difficulty = 'medium';
        gameConfig.iterations = 40;
        
        // Show setup panel, hide game state panel
        if (setupPanel) setupPanel.style.display = 'block';
        if (gameStatePanel) gameStatePanel.style.display = 'none';
        
        // End the game via GameStateManager
        if (window.GameStateManager?.endGame) {
          window.GameStateManager.endGame();
        } else if (window.resetGame) {
          window.resetGame();
        }
      });
    }

    // Update game state display
    window.updateGameStateDisplay = function() {
      if (!window.GameAPI) return;
      
      const snapshot = window.GameAPI.snapshot();
      const gameTurn = document.getElementById('gameTurn');
      const gamePhase = document.getElementById('gamePhase');
      const gameHPAlly = document.getElementById('gameHPAlly');
      const gameHPEnemy = document.getElementById('gameHPEnemy');
      const gameAPAlly = document.getElementById('gameAPAlly');
      const gameAPEnemy = document.getElementById('gameAPEnemy');
      const gameDragonHP = document.getElementById('gameDragonHP');
      
      if (gameTurn) {
        const actor = snapshot.currentActor;
        gameTurn.textContent = actor ? `${actor === 'ally' ? '🔵 P1' : (actor === 'enemy' ? '🔴 P2' : '🐉')}` : '—';
      }
      if (gamePhase) {
        const phase = window.GameStateManager?.getPhase?.() || (window.GameAPI.getPhase ? window.GameAPI.getPhase() : 'playing');
        gamePhase.textContent = phase;
      }
      
      const allyHP = Object.values(snapshot.pieces || {}).filter(p => p.player === 'ally').reduce((sum, p) => sum + (p.currentHp || 0), 0);
      const enemyHP = Object.values(snapshot.pieces || {}).filter(p => p.player === 'enemy').reduce((sum, p) => sum + (p.currentHp || 0), 0);
      const dragonPiece = Object.values(snapshot.pieces || {}).find(p => p.player === 'boss');
      const dragonHP = dragonPiece ? (dragonPiece.currentHp || 0) : 0;
      const allyMaxHP = snapshot.player?.ally?.hpTotal || 0;
      const enemyMaxHP = snapshot.player?.enemy?.hpTotal || 0;
      const allyAP = snapshot.player?.ally?.ap || 0;
      const enemyAP = snapshot.player?.enemy?.ap || 0;
      
      if (gameHPAlly) gameHPAlly.textContent = `${allyHP}/${allyMaxHP}`;
      if (gameHPEnemy) gameHPEnemy.textContent = `${enemyHP}/${enemyMaxHP}`;
      if (gameAPAlly) gameAPAlly.textContent = `${allyAP}`;
      if (gameAPEnemy) gameAPEnemy.textContent = `${enemyAP}`;
      if (gameDragonHP) gameDragonHP.textContent = `${dragonHP}`;
    };

    console.log('[AI] Controls initialized');
  };

  // Mark setup as complete (called after P2 finishes)
  window.markSetupComplete = function() {
    console.log('[AI] Setup marked as complete');
    setupComplete = true;
    // Ensure button stays enabled
    if (window.updateSetupStatus) {
      window.updateSetupStatus();
    }
  };

  // Export for debugging
  window.getAIConfig = () => gameConfig;

  // Debug function to test button click manually
  window.testStartGameButton = function() {
    console.log('[DEBUG] ===== TEST START GAME BUTTON =====');
    console.log('[DEBUG] window.initializeAIControls:', typeof window.initializeAIControls);
    console.log('[DEBUG] window.handleStartGameClick:', typeof window.handleStartGameClick);
    console.log('[DEBUG] window.GameAPI:', typeof window.GameAPI);
    if (window.GameAPI) {
      console.log('[DEBUG] window.GameAPI.startGame:', typeof window.GameAPI.startGame);
    }
    
    const btn = document.getElementById('btnStartGame');
    console.log('[DEBUG] btnStartGame found:', !!btn);
    if (btn) {
      console.log('[DEBUG] btnStartGame.disabled:', btn.disabled);
      console.log('[DEBUG] Simulating click...');
      btn.click();
      console.log('[DEBUG] Click simulated');
    }
  };

  // Handler for Start Game button (can be called from onclick attribute)
  // This is the DIRECT handler that avoids event dispatch loops
  window.handleStartGameClick = function() {
    console.log('[AI] ===== handleStartGameClick CALLED FROM ONCLICK =====');
    
    try {
      const btnStartGame = document.getElementById('btnStartGame');
      const setupPanel = document.getElementById('setupPanel');
      const gameStatePanel = document.getElementById('gameStatePanel');
      const p1DiffSelect = document.getElementById('p1Difficulty');
      const p2DiffSelect = document.getElementById('p2Difficulty');
      const iterationsInput = document.getElementById('aiIterations');
      
      console.log('[AI] btnStartGame exists:', !!btnStartGame);
      console.log('[AI] btnStartGame.disabled:', btnStartGame?.disabled);
      
      if (btnStartGame?.disabled) {
        console.log('[AI] Start button clicked but disabled');
        return;
      }
      
      // Capture AI configuration
      const p1Elem = document.querySelector('input[name="p1Type"][value="ai"]');
      const p2Elem = document.querySelector('input[name="p2Type"][value="ai"]');
      console.log('[AI] p1 AI radio button checked:', p1Elem?.checked);
      console.log('[AI] p2 AI radio button checked:', p2Elem?.checked);
      
      // Update gameConfig
      gameConfig.p1IsAI = p1Elem?.checked || false;
      gameConfig.p2IsAI = p2Elem?.checked || false;
      gameConfig.p1Difficulty = p1DiffSelect?.value || 'medium';
      gameConfig.p2Difficulty = p2DiffSelect?.value || 'medium';
      gameConfig.iterations = parseInt(iterationsInput?.value, 10) || 40;
      
      console.log('[AI] handleStartGameClick: gameConfig updated:', JSON.stringify(gameConfig));
      
      // Reset AI execution pause flag (crucial for human vs AI games)
      pauseAIExecution = false;
      console.log('[AI] handleStartGameClick: pauseAIExecution reset to false');
      
      // Call GameAPI.startGame directly
      if (window.GameAPI && window.GameAPI.startGame) {
        console.log('[AI] handleStartGameClick: Calling GameAPI.startGame()');
        const started = window.GameAPI.startGame();
        console.log('[AI] handleStartGameClick: GameAPI.startGame() returned:', started);
        
        if (started) {
          // Switch UI panels
          if (setupPanel) setupPanel.style.display = 'none';
          if (gameStatePanel) gameStatePanel.style.display = 'block';
          
          // Update game state display
          if (window.updateGameStateDisplay) {
            window.updateGameStateDisplay();
          }
          
          // Start stuck turn detection for AI vs AI games
          if (gameConfig.p1IsAI && gameConfig.p2IsAI) {
            console.log('[AI] handleStartGameClick: AI vs AI detected, starting stuck turn detection');
            startStuckTurnDetection();
          }
          
          // Trigger AI if P1 is AI
          if (gameConfig.p1IsAI) {
            console.log('[AI] handleStartGameClick: P1 is AI, scheduling turn');
            setTimeout(() => window.executeAITurnIfNeeded(), 500);
          } else {
            console.log('[AI] handleStartGameClick: P1 is Human');
          }
        }
      } else {
        console.error('[AI] handleStartGameClick: GameAPI not available');
      }
    } catch(e) {
      console.error('[AI] handleStartGameClick: Exception:', e);
      console.error('[AI] handleStartGameClick: Stack:', e.stack);
    }
  };

  // Auto-initialize AI controls when this script loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[AI] DOMContentLoaded firing, initializing controls');
      window.initializeAIControls();
    });
  } else {
    console.log('[AI] DOM already loaded, initializing controls immediately');
    window.initializeAIControls();
  }
})();
