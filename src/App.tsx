import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Trophy, 
  RotateCcw, 
  Brain, 
  ChevronRight, 
  Info, 
  Zap, 
  History,
  Activity,
  Cpu,
  BarChart3,
  Folder,
  LogOut,
  LogIn,
  Save,
  Trash2,
  X as CloseIcon
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { 
  GameState, 
  INITIAL_STATE, 
  makeMove, 
  indexToNotation, 
  getSubGridIndex,
  getCellInSubGridIndex,
  getGlobalIndex,
  Player,
  runPlayout,
  SimulationResult,
  getInitialSimResult,
  getLegalMoves,
  evaluate,
  findForcedWin
} from './lib/game-engine';
import { cn } from './lib/utils';
import { GoogleGenAI } from "@google/genai";
import { Toaster, toast } from 'react-hot-toast';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  Timestamp, 
  deleteDoc, 
  doc, 
  OperationType, 
  handleFirestoreError,
  checkConnection,
  signInAnonymously,
  setDoc,
  updateDoc,
  getDoc,
  User
} from './lib/firebase';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const TOTAL_SIMULATIONS = 2000;
const SIM_BATCH_SIZE = 50;

interface SavedMatch extends GameState {
  id: string;
  timestamp: any;
  userId: string;
  matchName: string;
}

export default function App() {
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [history, setHistory] = useState<GameState[]>([INITIAL_STATE]);
  const [simResult, setSimResult] = useState<SimulationResult>(getInitialSimResult());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiAnalysisText, setAiAnalysisText] = useState<string | null>(null);
  
  // Firebase State
  const [user, setUser] = useState<User | null>(null);
  const [savedMatches, setSavedMatches] = useState<SavedMatch[]>([]);
  const [showMatches, setShowMatches] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  
  // Multiplayer State
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomData, setRoomData] = useState<any>(null);
  const [mySymbol, setMySymbol] = useState<Player>(null);
  const [isLobbyOpen, setIsLobbyOpen] = useState(true);
  const [inputCode, setInputCode] = useState('');
  const [roomOptions, setRoomOptions] = useState({
    showAnalysis: true,
    p1Symbol: 'X' as Player | 'random',
    startingPlayer: 'p1' as 'p1' | 'p2' | 'random'
  });
  const [isAnalysisVisible, setIsAnalysisVisible] = useState(true);

  const simRef = useRef<number>(0);
  const animationRef = useRef<number | null>(null);

  // Simulation Loop
  useEffect(() => {
    if (state.isGameOver) {
      setSimResult(getInitialSimResult());
      if (state.winner) {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: state.winner === 'X' ? ['#0000FF', '#3b82f6'] : ['#FF0000', '#ef4444']
        });
      }
      return;
    }

    // Initialize with a heuristic prior to avoid "0%" or "100%" jumps at start
    // and to differentiate moves immediately.
    const hScore = evaluate(state);
    // Convert heuristic score to a virtual win/loss count
    // A score of 1000 is roughly a strong advantage
    const virtualTotal = 500; // Increased for even more stability
    const xWinProb = 1 / (1 + Math.exp(-hScore / 400));
    const virtualWinsX = Math.round(virtualTotal * xWinProb);
    const virtualWinsO = virtualTotal - virtualWinsX;

    const initialSim = getInitialSimResult();
    initialSim.total = virtualTotal;
    initialSim.winsX = virtualWinsX;
    initialSim.winsO = virtualWinsO;
    
    const legalMoves = getLegalMoves(state);
    legalMoves.forEach(m => {
      // Prior for each move based on its immediate heuristic
      const nextState = makeMove(state, m);
      const moveHScore = evaluate(nextState);
      const moveWinProb = 1 / (1 + Math.exp(-(moveHScore * (state.nextPlayer === 'X' ? 1 : -1)) / 400));
      
      const moveVirtualTotal = 50;
      const moveVirtualWins = Math.round(moveVirtualTotal * moveWinProb);
      
      initialSim.moveScores[m] = { 
        wins: moveVirtualWins, 
        total: moveVirtualTotal 
      };
    });
    
    setSimResult(initialSim);
    simRef.current = 0;
    setIsAnalyzing(true);

    const runBatch = () => {
      if (simRef.current >= TOTAL_SIMULATIONS) {
        setIsAnalyzing(false);
        return;
      }

      setSimResult(prev => {
        const next = { 
          ...prev,
          moveScores: { ...prev.moveScores }
        };
        const moves = Object.keys(next.moveScores).map(Number);
        if (moves.length === 0) return next;
        
        for (let i = 0; i < SIM_BATCH_SIZE && simRef.current < TOTAL_SIMULATIONS; i++) {
          // Pick a move to simulate (round robin)
          const moveIdx = moves[simRef.current % moves.length];
          const nextState = makeMove(state, moveIdx);
          const result = runPlayout(nextState);
          
          if (result === 1) next.winsX++;
          else if (result === -1) next.winsO++;
          else next.draws++;
          
          next.total++;
          
          // Immutable update for moveScores
          const currentMoveStats = next.moveScores[moveIdx];
          next.moveScores[moveIdx] = {
            wins: currentMoveStats.wins + (
              (state.nextPlayer === 'X' && result === 1) || 
              (state.nextPlayer === 'O' && result === -1) ? 1 : 0
            ),
            total: currentMoveStats.total + 1
          };
          
          simRef.current++;
        }
        return next;
      });

      animationRef.current = requestAnimationFrame(runBatch);
    };

    animationRef.current = requestAnimationFrame(runBatch);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [state]);

  // Firebase Auth Effect
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (user) {
        if (!user.isAnonymous) {
          toast.success(`Welcome, ${user.displayName || 'User'}!`);
        }
      } else {
        signInAnonymously(auth).catch(console.error);
      }
    });
    
    // Check DB connection
    checkConnection().then(connected => {
      setDbConnected(connected);
      if (!connected) {
        toast.error("Firebase Database not reachable. Check your console settings.");
      }
    });

    return () => unsubscribe();
  }, []);

  // Room Sync Effect
  useEffect(() => {
    if (!roomCode) return;

    const unsubscribe = onSnapshot(doc(db, 'rooms', roomCode), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setRoomData(data);
        setState({
          board: data.board,
          subGridWinners: data.subGridWinners,
          nextPlayer: data.nextPlayer,
          activeSubGrid: data.activeSubGrid,
          winner: data.winner,
          isGameOver: data.isGameOver
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `rooms/${roomCode}`);
    });

    return () => unsubscribe();
  }, [roomCode]);

  // Fog of War Effect
  useEffect(() => {
    if (!roomCode) {
      setIsAnalysisVisible(true);
      return;
    }
    
    if (state.nextPlayer === mySymbol) {
      setIsAnalysisVisible(false);
      const timer = setTimeout(() => setIsAnalysisVisible(true), 5000);
      return () => clearTimeout(timer);
    } else {
      setIsAnalysisVisible(false);
    }
  }, [state.nextPlayer, mySymbol, roomCode]);

  // Firebase Matches Effect
  useEffect(() => {
    if (!user) {
      setSavedMatches([]);
      return;
    }

    const q = query(
      collection(db, 'matches'),
      where('userId', '==', user.uid),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const matches = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SavedMatch[];
      setSavedMatches(matches);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'matches');
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const saveCurrentMatch = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const matchName = `Match ${new Date().toLocaleString()}`;
      await addDoc(collection(db, 'matches'), {
        board: state.board,
        subGridWinners: state.subGridWinners,
        nextPlayer: state.nextPlayer,
        activeSubGrid: state.activeSubGrid,
        winner: state.winner,
        isGameOver: state.isGameOver,
        timestamp: Timestamp.now(),
        userId: user.uid,
        matchName
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'matches');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteMatch = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, 'matches', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `matches/${id}`);
    }
  };

  const loadMatch = (match: SavedMatch) => {
    const loadedState: GameState = {
      board: match.board,
      subGridWinners: match.subGridWinners,
      nextPlayer: match.nextPlayer,
      activeSubGrid: match.activeSubGrid,
      winner: match.winner,
      isGameOver: match.isGameOver
    };
    setState(loadedState);
    setHistory([loadedState]);
    setShowMatches(false);
  };

  const handleMove = async (index: number) => {
    if (state.board[index] !== null || state.isGameOver) return;
    
    // Multiplayer checks
    if (roomCode && roomData) {
      if (state.nextPlayer !== mySymbol) {
        toast.error("It's not your turn!");
        return;
      }
      if (roomData.status === 'waiting') {
        toast.error("Waiting for opponent...");
        return;
      }
    }

    const subGridIdx = getSubGridIndex(index);
    if (state.activeSubGrid !== null && state.activeSubGrid !== subGridIdx) return;
    if (state.subGridWinners[subGridIdx] !== null && state.activeSubGrid !== null) return;

    const newState = makeMove(state, index);
    
    if (roomCode) {
      try {
        await updateDoc(doc(db, 'rooms', roomCode), {
          board: newState.board,
          subGridWinners: newState.subGridWinners,
          nextPlayer: newState.nextPlayer,
          activeSubGrid: newState.activeSubGrid,
          winner: newState.winner,
          isGameOver: newState.isGameOver,
          lastMoveAt: Timestamp.now()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomCode}`);
      }
    } else {
      setState(newState);
      setHistory(prev => [...prev, newState]);
      setAiAnalysisText(null);
    }
  };

  const createRoom = async () => {
    if (!user) {
      await signInAnonymously(auth);
    }
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const p1Symbol = roomOptions.p1Symbol === 'random' ? (Math.random() > 0.5 ? 'X' : 'O') : roomOptions.p1Symbol;
    const p2Symbol = p1Symbol === 'X' ? 'O' : 'X';
    
    let nextPlayer: Player = 'X';
    if (roomOptions.startingPlayer === 'p1') {
      nextPlayer = p1Symbol;
    } else if (roomOptions.startingPlayer === 'p2') {
      nextPlayer = p2Symbol;
    } else {
      nextPlayer = Math.random() > 0.5 ? 'X' : 'O';
    }
    
    const initialRoom = {
      board: INITIAL_STATE.board,
      subGridWinners: INITIAL_STATE.subGridWinners,
      nextPlayer,
      activeSubGrid: INITIAL_STATE.activeSubGrid,
      winner: INITIAL_STATE.winner,
      isGameOver: INITIAL_STATE.isGameOver,
      status: 'waiting',
      players: { p1: auth.currentUser?.uid },
      p1Symbol,
      p2Symbol,
      options: roomOptions,
      createdAt: Timestamp.now()
    };

    try {
      await setDoc(doc(db, 'rooms', code), initialRoom);
      setRoomCode(code);
      setMySymbol(p1Symbol);
      setIsLobbyOpen(false);
      toast.success(`Room ${code} created!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `rooms/${code}`);
    }
  };

  const joinRoom = async (code: string) => {
    if (!user) {
      await signInAnonymously(auth);
    }
    try {
      const roomRef = doc(db, 'rooms', code);
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) {
        toast.error("Room not found.");
        return;
      }
      const data = roomSnap.data();
      if (data.status !== 'waiting') {
        toast.error("Room is already full or finished.");
        return;
      }

      await updateDoc(roomRef, {
        'players.p2': auth.currentUser?.uid,
        status: 'playing'
      });

      setRoomCode(code);
      setMySymbol(data.p2Symbol);
      setIsLobbyOpen(false);
      toast.success(`Joined room ${code}!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rooms/${code}`);
    }
  };

  const resetGame = () => {
    setState(INITIAL_STATE);
    setHistory([INITIAL_STATE]);
    setAiAnalysisText(null);
  };

  const undoMove = () => {
    if (history.length > 1) {
      const newHistory = history.slice(0, -1);
      setHistory(newHistory);
      setState(newHistory[newHistory.length - 1]);
      setAiAnalysisText(null);
    }
  };

  const leaveRoom = () => {
    setRoomCode(null);
    setRoomData(null);
    setMySymbol(null);
    setIsLobbyOpen(true);
    setState(INITIAL_STATE);
    setHistory([INITIAL_STATE]);
  };

  const getAiInsight = async () => {
    setAiThinking(true);
    try {
      const boardString = state.board.map((cell, i) => {
        const notation = indexToNotation(i);
        return `${notation}:${cell || '.'}`;
      }).join(' ');

      const prompt = `Analyze the current Ultimate Tic-Tac-Toe position. 
      Current Player: ${state.nextPlayer}
      Active Sub-grid: ${state.activeSubGrid !== null ? String.fromCharCode(65 + state.activeSubGrid) : 'Any'}
      Board State (Notation:Value): ${boardString}
      Sub-grid Winners: ${state.subGridWinners.map((w, i) => `${String.fromCharCode(65 + i)}:${w || '.'}`).join(' ')}
      
      Provide a concise strategic analysis (max 3 sentences) and suggest the best move with reasoning. Use the A1-I9 notation.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });

      setAiAnalysisText(response.text || "Unable to generate analysis.");
      toast.success("Analysis complete!");
    } catch (error) {
      console.error("AI Analysis error:", error);
      setAiAnalysisText("Error generating AI insight. Please check your API key.");
      toast.error("AI Analysis failed.");
    } finally {
      setAiThinking(false);
    }
  };

  // Evaluation Percentage: P = ((W - L) / n + 1) / 2 * 100
  const evalPercentage = useMemo(() => {
    // Check for forced wins first
    const forced = findForcedWin(state, 2);
    if (forced) {
      return forced.winner === 'X' ? 100 : 0;
    }

    if (simResult.total === 0) return 50;
    
    // Standard win-rate calculation
    const net = simResult.winsX - simResult.winsO;
    let rawP = ((net / simResult.total + 1) / 2) * 100;
    
    // Ensure it's exactly 50 if the net is 0
    if (net === 0) return 50;

    return rawP;
  }, [simResult, state]);

  // Relative Score: (W - L) / n * 10
  const relativeScore = useMemo(() => {
    if (simResult.total === 0) return 0;
    return ((simResult.winsX - simResult.winsO) / simResult.total) * 10;
  }, [simResult]);

  const topMoves = useMemo(() => {
    return Object.entries(simResult.moveScores)
      .map(([move, stats]) => {
        const moveIdx = Number(move);
        const s = stats as { wins: number, total: number };
        
        // Check if this specific move leads to a forced win/loss
        const nextState = makeMove(state, moveIdx);
        const forced = findForcedWin(nextState, 2); // Depth 2 check for the next state
        
        let winRate = s.total > 0 ? (s.wins / s.total) * 100 : 0;
        
        if (nextState.winner === state.nextPlayer) {
          winRate = 100;
        } else if (forced) {
          // If forced.winner is the opponent, it means moving here leads to a forced loss
          if (forced.winner !== state.nextPlayer) winRate = 0;
          // If forced.winner is the current player, it means moving here leads to a forced win
          else winRate = 100;
        }

        return {
          move: moveIdx,
          winRate,
          total: s.total
        };
      })
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 3);
  }, [simResult.moveScores, state]);

  return (
    <div className="min-h-screen bg-[#060606] text-[#e4e4e4] font-sans selection:bg-[#2E5BFF]/30">
      <Toaster position="top-right" toastOptions={{
        style: {
          background: '#1a1a1a',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.1)'
        }
      }} />
      {/* Header */}
      <header className="border-b border-white/5 bg-black/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#2E5BFF] rounded flex items-center justify-center shadow-[0_0_15px_rgba(46,91,255,0.3)]">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">ULTIMATE <span className="text-[#2E5BFF]">ANALYZER</span></h1>
          </div>
          
          <div className="flex items-center gap-4">
            {roomCode && (
              <div className="flex items-center gap-3 px-4 py-1.5 bg-white/5 rounded-full border border-white/10">
                <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Room</span>
                <span className="text-sm font-black text-[#2E5BFF]">{roomCode}</span>
                <button onClick={leaveRoom} className="p-1 hover:text-red-500 transition-colors">
                  <LogOut className="w-3 h-3" />
                </button>
              </div>
            )}
            {user ? (
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setShowMatches(true)}
                  className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors relative group"
                  title="My Matches"
                >
                  <Folder className="w-5 h-5" />
                  {savedMatches.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                      {savedMatches.length}
                    </span>
                  )}
                </button>
                <button 
                  onClick={saveCurrentMatch}
                  disabled={isSaving}
                  className="p-2 rounded-lg bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                  title="Save Match"
                >
                  <Save className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-2 pl-2 border-l border-white/10">
                  <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-8 h-8 rounded-full border border-white/20" />
                  <button onClick={handleLogout} className="p-2 text-white/40 hover:text-white transition-colors">
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-sm font-medium border border-white/10"
              >
                <LogIn className="w-4 h-4" />
                Sign In
              </button>
            )}
            <div className="hidden md:flex items-center gap-6 text-[10px] font-mono text-white/40 uppercase tracking-[0.2em]">
              <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full", dbConnected === true ? "bg-emerald-500" : dbConnected === false ? "bg-red-500" : "bg-yellow-500")} />
                <span>DB: {dbConnected === true ? 'Online' : dbConnected === false ? 'Offline' : 'Connecting...'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className={cn("w-3 h-3", isAnalyzing && "text-[#2E5BFF] animate-pulse")} />
                <span>{isAnalyzing ? `Simulating: ${simResult.total}` : 'Analysis Idle'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Cpu className="w-3 h-3" />
                <span>Iter: {TOTAL_SIMULATIONS}</span>
              </div>
            </div>
            <button 
              onClick={resetGame}
              className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/60 hover:text-white"
              title="Reset Game"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8">
        <AnimatePresence mode="wait">
          {isLobbyOpen ? (
            <motion.div 
              key="lobby"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-md mx-auto flex flex-col gap-8 py-12"
            >
              <div className="text-center">
                <h2 className="text-4xl font-black tracking-tighter mb-2">MULTIPLAYER LOBBY</h2>
                <p className="text-white/40 font-mono text-xs uppercase tracking-[0.3em]">Select your operation</p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="bg-white/5 p-6 rounded-2xl border border-white/10 flex flex-col gap-4">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-[#2E5BFF]">Create Room</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/60">Show Analysis</span>
                      <button 
                        onClick={() => setRoomOptions(prev => ({ ...prev, showAnalysis: !prev.showAnalysis }))}
                        className={cn(
                          "w-10 h-5 rounded-full transition-colors relative",
                          roomOptions.showAnalysis ? "bg-[#2E5BFF]" : "bg-white/10"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                          roomOptions.showAnalysis ? "left-6" : "left-1"
                        )} />
                      </button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="text-xs text-white/60">Your Symbol</span>
                      <div className="grid grid-cols-3 gap-2">
                        {['X', 'O', 'random'].map(s => (
                          <button
                            key={s}
                            onClick={() => setRoomOptions(prev => ({ ...prev, p1Symbol: s as any }))}
                            className={cn(
                              "py-2 rounded-lg border text-xs font-bold transition-all",
                              roomOptions.p1Symbol === s ? "bg-[#2E5BFF] border-[#2E5BFF] text-white" : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                            )}
                          >
                            {s.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="text-xs text-white/60">Who Starts</span>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'p1', label: 'ME' },
                          { id: 'p2', label: 'FRIEND' },
                          { id: 'random', label: 'RANDOM' }
                        ].map(s => (
                          <button
                            key={s.id}
                            onClick={() => setRoomOptions(prev => ({ ...prev, startingPlayer: s.id as any }))}
                            className={cn(
                              "py-2 rounded-lg border text-[10px] font-bold transition-all",
                              roomOptions.startingPlayer === s.id ? "bg-[#2E5BFF] border-[#2E5BFF] text-white" : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                            )}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button 
                      onClick={createRoom}
                      className="w-full py-4 bg-[#2E5BFF] hover:bg-[#2E5BFF]/80 text-white rounded-xl font-black transition-all shadow-lg shadow-[#2E5BFF]/20"
                    >
                      INITIALIZE ROOM
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-4 opacity-20">
                  <div className="h-px flex-1 bg-white" />
                  <span className="text-[10px] font-mono">OR</span>
                  <div className="h-px flex-1 bg-white" />
                </div>

                <div className="bg-white/5 p-6 rounded-2xl border border-white/10 flex flex-col gap-4">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-[#FF3131]">Join Room</h3>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="4-DIGIT CODE"
                      value={inputCode}
                      onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                      maxLength={4}
                      className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 font-mono text-center tracking-[0.5em] focus:outline-none focus:border-[#FF3131] transition-colors"
                    />
                    <button 
                      onClick={() => joinRoom(inputCode)}
                      className="px-6 bg-[#FF3131] hover:bg-[#FF3131]/80 text-white rounded-xl font-black transition-all"
                    >
                      JOIN
                    </button>
                  </div>
                </div>
                
                <button 
                  onClick={() => setIsLobbyOpen(false)}
                  className="text-xs text-white/20 hover:text-white/60 transition-colors uppercase tracking-widest font-mono"
                >
                  Skip to Local Analysis
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="game"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 lg:grid-cols-[auto_1fr_350px] gap-8"
            >
              {/* Eval Bar */}
              <div className="hidden lg:flex flex-col items-center gap-4">
                <div className="h-[500px] w-8 bg-[#000000] rounded-xl relative overflow-hidden border border-white/10">
                  <AnimatePresence>
                    {isAnalysisVisible && (roomData?.options?.showAnalysis !== false) && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0"
                      >
                        {/* O Advantage (Neon Red) - Bottom Layer */}
                        <div className="absolute inset-0 bg-[#FF3131]/70" />
                        
                        {/* X Advantage (Electric Blue) - Top Part */}
                        <motion.div 
                          className="absolute top-0 left-0 right-0 bg-[#2E5BFF]/70 z-10"
                          initial={{ height: '50%' }}
                          animate={{ height: `${evalPercentage}%` }}
                          transition={{ duration: 0.1, ease: "linear" }}
                        >
                          {/* Percentage Label X (Only if dominant) */}
                          {evalPercentage > 50 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs font-black text-white select-none">
                                {evalPercentage.toFixed(0)}%
                              </span>
                            </div>
                          )}
                          {/* 50% Label (Top) */}
                          {Math.abs(evalPercentage - 50) < 0.1 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs font-black text-white/40 select-none">
                                50%
                              </span>
                            </div>
                          )}
                        </motion.div>

                        {/* Percentage Label O (Only if dominant) */}
                        {(100 - evalPercentage) > 50 && (
                          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center z-20" style={{ height: `${100 - evalPercentage}%` }}>
                            <span className="text-xs font-black text-white select-none">
                              {(100 - evalPercentage).toFixed(0)}%
                            </span>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  
                  {/* 50% Marker */}
                  <div className="absolute top-1/2 left-0 right-0 h-px border-t border-white/10 z-30" />
                  
                  {/* Fog of War / Hidden State */}
                  {!isAnalysisVisible && roomCode && roomData?.options?.showAnalysis !== false && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] z-40">
                      <div className="flex flex-col items-center gap-2">
                        <Activity className="w-4 h-4 text-white/20 animate-pulse" />
                        <span className="text-[8px] font-mono text-white/20 uppercase vertical-rl rotate-180 tracking-widest">Calculating</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="text-[10px] font-mono text-white/40 uppercase vertical-rl rotate-180 tracking-[0.3em]">
                  Advantage Bar
                </div>
              </div>

              {/* Main Board Area */}
              <div className="flex flex-col gap-6">
                {roomCode && roomData?.status === 'waiting' && (
                  <div className="bg-[#2E5BFF]/10 border border-[#2E5BFF]/30 p-4 rounded-xl flex items-center justify-between animate-pulse">
                    <div className="flex items-center gap-3">
                      <Activity className="w-4 h-4 text-[#2E5BFF]" />
                      <span className="text-sm font-bold text-[#2E5BFF]">WAITING FOR OPPONENT...</span>
                    </div>
                    <div className="text-xs font-mono text-[#2E5BFF]/60">CODE: {roomCode}</div>
                  </div>
                )}
                
                <div className="relative aspect-square max-w-[600px] w-full mx-auto bg-white/[0.02] p-3 rounded-2xl border border-white/10 shadow-2xl">
                  {/* The 9x9 Grid */}
                  <div className="grid grid-cols-3 grid-rows-3 gap-3 h-full w-full">
                    {Array.from({ length: 9 }).map((_, subGridIdx) => (
                      <SubGrid 
                        key={subGridIdx}
                        index={subGridIdx}
                        state={state}
                        onMove={handleMove}
                        isNext={state.activeSubGrid === subGridIdx || state.activeSubGrid === null}
                      />
                    ))}
                  </div>

                  {/* Game Over Overlay */}
                  <AnimatePresence>
                    {state.isGameOver && (
                      <motion.div 
                        initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                        animate={{ opacity: 1, backdropFilter: 'blur(8px)' }}
                        exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                        className="absolute inset-0 z-40 bg-black/60 flex flex-col items-center justify-center rounded-2xl border border-white/20"
                      >
                        <motion.div
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', delay: 0.2 }}
                        >
                          <Trophy className={cn(
                            "w-24 h-24 mb-6",
                            state.winner === 'X' ? "text-[#2E5BFF]" : state.winner === 'O' ? "text-[#FF3131]" : "text-gray-400"
                          )} />
                        </motion.div>
                        <h2 className="text-5xl font-black mb-2 tracking-tighter">
                          {state.winner ? `${state.winner} DOMINATES` : "STALEMATE"}
                        </h2>
                        <p className="text-white/40 mb-10 font-mono text-xs uppercase tracking-[0.4em]">Final Engine Evaluation</p>
                        <button 
                          onClick={roomCode ? leaveRoom : resetGame}
                          className="px-10 py-4 bg-[#2E5BFF] hover:bg-[#2E5BFF]/80 text-white rounded-xl font-black transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-[#2E5BFF]/20"
                        >
                          {roomCode ? "EXIT ROOM" : "RESTART ANALYZER"}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Controls & Status */}
                <div className="flex items-center justify-between bg-white/5 p-5 rounded-2xl border border-white/10">
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-white/30 uppercase tracking-[0.2em] mb-1">Turn</span>
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-4 h-4 rounded-full",
                          state.nextPlayer === 'X' ? "bg-[#2E5BFF] shadow-[0_0_15px_rgba(46,91,255,0.5)]" : "bg-[#FF3131] shadow-[0_0_15px_rgba(255,49,49,0.5)]"
                        )} />
                        <span className="font-black text-xl tracking-tight">
                          {state.nextPlayer}
                          {roomCode && state.nextPlayer === mySymbol && <span className="ml-2 text-[10px] text-[#2E5BFF] animate-pulse">(YOU)</span>}
                        </span>
                      </div>
                    </div>
                    <div className="w-px h-10 bg-white/10" />
                    <div className="flex flex-col">
                      <span className="text-[10px] text-white/30 uppercase tracking-[0.2em] mb-1">Evaluation</span>
                      <span className={cn(
                        "font-mono font-black text-xl tracking-tight",
                        relativeScore > 0 ? "text-[#2E5BFF]" : relativeScore < 0 ? "text-[#FF3131]" : "text-white/40"
                      )}>
                        {isAnalysisVisible || !roomCode ? (
                          relativeScore > 0 ? `+${relativeScore.toFixed(1)}` : relativeScore.toFixed(1)
                        ) : "???"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {!roomCode && (
                      <button 
                        onClick={undoMove}
                        disabled={history.length <= 1}
                        className="p-3 hover:bg-white/10 rounded-xl transition-colors disabled:opacity-20"
                      >
                        <RotateCcw className="w-5 h-5" />
                      </button>
                    )}
                    <button 
                      onClick={getAiInsight}
                      disabled={aiThinking || state.isGameOver || (roomCode && state.nextPlayer !== mySymbol)}
                      className="flex items-center gap-3 px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all disabled:opacity-40 border border-white/10"
                    >
                      {aiThinking ? (
                        <motion.div 
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                        >
                          <Brain className="w-5 h-5 text-[#2E5BFF]" />
                        </motion.div>
                      ) : (
                        <Brain className="w-5 h-5 text-[#2E5BFF]" />
                      )}
                      <span className="text-sm font-bold tracking-tight">AI Insight</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Sidebar Analysis */}
              <aside className="flex flex-col gap-6">
                {/* Top Moves */}
                <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
                  <div className="p-4 bg-white/[0.02] border-b border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-[#2E5BFF]" />
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Engine Analysis</h3>
                    </div>
                    <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">n=2000</span>
                  </div>
                  <div className="p-2 flex flex-col gap-1">
                    {(!isAnalysisVisible && roomCode) ? (
                      <div className="p-8 text-center text-white/10 text-[10px] uppercase tracking-[0.3em] italic">
                        Fog of War Active
                      </div>
                    ) : isAnalyzing && simResult.total < 100 ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-12 bg-white/5 rounded-lg" />
                      ))
                    ) : topMoves.length > 0 ? (
                      topMoves.map((item, i) => (
                        <button 
                          key={i}
                          onClick={() => handleMove(item.move)}
                          className="flex items-center justify-between p-3 hover:bg-white/10 rounded-xl transition-all group"
                        >
                          <div className="flex items-center gap-4">
                            <span className="text-[10px] font-mono text-white/20">{i + 1}</span>
                            <span className="font-black text-base tracking-tighter">{indexToNotation(item.move)}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className={cn(
                              "text-sm font-mono font-bold",
                              item.winRate > 50 ? "text-[#2E5BFF]" : item.winRate < 50 ? "text-[#FF3131]" : "text-white/40"
                            )}>
                              {item.winRate.toFixed(0)}%
                            </span>
                            <ChevronRight className="w-4 h-4 text-white/10 group-hover:text-[#2E5BFF] transition-colors" />
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="p-8 text-center text-white/20 text-[10px] uppercase tracking-[0.3em] italic">
                        Idle
                      </div>
                    )}
                  </div>
                </div>

                {/* AI Insight Card */}
                <AnimatePresence>
                  {aiAnalysisText && (
                    <motion.div 
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="bg-[#2E5BFF]/5 rounded-2xl border border-[#2E5BFF]/20 p-5 relative overflow-hidden group"
                    >
                      <div className="absolute top-0 left-0 w-1 h-full bg-[#2E5BFF]/40" />
                      <div className="flex items-center gap-2 mb-4">
                        <Brain className="w-4 h-4 text-[#2E5BFF]" />
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2E5BFF]">Gemini Strategic Analysis</h3>
                      </div>
                      <p className="text-sm leading-relaxed text-[#2E5BFF]/70 italic font-medium">
                        "{aiAnalysisText}"
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Move History */}
                <div className="bg-white/5 rounded-2xl border border-white/10 flex-1 flex flex-col overflow-hidden">
                  <div className="p-4 bg-white/[0.02] border-b border-white/10 flex items-center gap-2">
                    <History className="w-4 h-4 text-white/30" />
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Game History</h3>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                      {history.slice(1).map((h, i) => {
                        const prevBoard = history[i].board;
                        const currentBoard = h.board;
                        const moveIdx = currentBoard.findIndex((cell, idx) => cell !== prevBoard[idx]);
                        
                        return (
                          <div key={i} className="flex items-center gap-3 p-1">
                            <span className="text-[10px] font-mono text-white/10 w-4">{Math.floor(i / 2) + 1}.</span>
                            <span className={cn(
                              "font-mono text-xs font-bold",
                              i % 2 === 0 ? "text-[#2E5BFF]" : "text-[#FF3131]"
                            )}>
                              {indexToNotation(moveIdx)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </aside>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Info */}
      <footer className="max-w-7xl mx-auto p-10 border-t border-white/5 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 opacity-20">
          <div className="flex items-center gap-10 text-[9px] font-black uppercase tracking-[0.4em]">
            <div className="flex items-center gap-2">
              <Info className="w-3 h-3" />
              <span>Notation: A1-I9</span>
            </div>
            <span>Monte Carlo Engine</span>
            <span>2000 Iterations</span>
          </div>
          <div className="text-[9px] font-mono tracking-widest">
            ULTIMATE ANALYZER PRO v2.0
          </div>
        </div>
      </footer>

      {/* Matches Modal */}
      <AnimatePresence>
        {showMatches && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMatches(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-2xl bg-[#0f0f0f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/5">
                <div className="flex items-center gap-3">
                  <Folder className="w-6 h-6 text-emerald-500" />
                  <h2 className="text-xl font-bold">My Saved Matches</h2>
                </div>
                <button onClick={() => setShowMatches(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <CloseIcon className="w-5 h-5" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {savedMatches.length === 0 ? (
                  <div className="text-center py-12 text-white/40">
                    <History className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>No saved matches yet.</p>
                  </div>
                ) : (
                  savedMatches.map(match => (
                    <div 
                      key={match.id}
                      onClick={() => loadMatch(match)}
                      className="group p-4 bg-white/5 border border-white/5 rounded-xl hover:border-emerald-500/50 hover:bg-white/10 transition-all cursor-pointer flex items-center justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-black/40 flex items-center justify-center border border-white/10">
                          <Trophy className={cn(
                            "w-6 h-6",
                            match.winner === 'X' ? "text-blue-500" : match.winner === 'O' ? "text-red-500" : "text-white/20"
                          )} />
                        </div>
                        <div>
                          <h3 className="font-medium text-white group-hover:text-emerald-400 transition-colors">{match.matchName}</h3>
                          <p className="text-xs text-white/40 font-mono">
                            {new Date(match.timestamp?.seconds * 1000).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="px-2 py-1 rounded bg-white/5 border border-white/10 text-[10px] font-mono uppercase">
                          {match.winner ? `Winner: ${match.winner}` : "In Progress"}
                        </div>
                        <button 
                          onClick={(e) => deleteMatch(e, match.id)}
                          className="p-2 text-white/20 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface SubGridProps {
  index: number;
  state: GameState;
  onMove: (idx: number) => void;
  isNext: boolean;
}

const SubGrid: React.FC<SubGridProps> = ({ 
  index, 
  state, 
  onMove, 
  isNext 
}) => {
  const winner = state.subGridWinners[index];
  const isFull = useMemo(() => {
    for (let i = 0; i < 9; i++) {
      if (state.board[getGlobalIndex(index, i)] === null) return false;
    }
    return true;
  }, [state.board, index]);

  return (
    <div className={cn(
      "relative grid grid-cols-3 grid-rows-3 gap-1.5 p-1.5 rounded-xl transition-all duration-500",
      isNext && !winner && !isFull ? "bg-white/10 ring-1 ring-white/20 shadow-lg shadow-white/5" : "bg-white/[0.02] opacity-40",
      winner === 'X' && "bg-[#2E5BFF]/10 ring-1 ring-[#2E5BFF]/30",
      winner === 'O' && "bg-[#FF3131]/10 ring-1 ring-[#FF3131]/30"
    )}>
      {Array.from({ length: 9 }).map((_, cellIdx) => {
        const globalIdx = getGlobalIndex(index, cellIdx);
        const value = state.board[globalIdx];
        
        return (
          <button
            key={cellIdx}
            onClick={() => onMove(globalIdx)}
            disabled={value !== null || winner !== null || (!isNext && state.activeSubGrid !== null)}
            className={cn(
              "aspect-square rounded-md flex items-center justify-center text-xl font-black transition-all duration-200",
              !value && isNext && !winner && "hover:bg-white/10 cursor-pointer active:scale-90",
              value === 'X' && "text-[#2E5BFF] drop-shadow-[0_0_8px_rgba(46,91,255,0.4)]",
              value === 'O' && "text-[#FF3131] drop-shadow-[0_0_8px_rgba(255,49,49,0.4)]",
              !value && "text-transparent"
            )}
          >
            {value || '.'}
          </button>
        );
      })}

      {/* Winner Overlay */}
      <AnimatePresence>
        {winner && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.2, rotate: -45 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
          >
            <span className={cn(
              "text-7xl font-black select-none tracking-tighter",
              winner === 'X' ? "text-[#2E5BFF]/90 drop-shadow-[0_0_20px_rgba(46,91,255,0.6)]" : "text-[#FF3131]/90 drop-shadow-[0_0_20px_rgba(255,49,49,0.6)]"
            )}>
              {winner}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
