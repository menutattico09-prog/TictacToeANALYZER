/**
 * Ultimate Tic-Tac-Toe Game Engine and AI
 */

export type Player = 'X' | 'O' | null;
export type Board = Player[]; // 81 cells
export type SubGridWinners = Player[]; // 9 sub-grids

export interface GameState {
  board: Board;
  subGridWinners: SubGridWinners;
  nextPlayer: Player;
  activeSubGrid: number | null; // 0-8, or null if any sub-grid is allowed
  winner: Player;
  isGameOver: boolean;
}

export const INITIAL_STATE: GameState = {
  board: Array(81).fill(null),
  subGridWinners: Array(9).fill(null),
  nextPlayer: 'X',
  activeSubGrid: null,
  winner: null,
  isGameOver: false,
};

// Helper to get sub-grid index from 0-80 index
export const getSubGridIndex = (index: number): number => {
  const row = Math.floor(index / 9);
  const col = index % 9;
  const subRow = Math.floor(row / 3);
  const subCol = Math.floor(col / 3);
  return subRow * 3 + subCol;
};

// Helper to get cell index within sub-grid (0-8)
export const getCellInSubGridIndex = (index: number): number => {
  const row = Math.floor(index / 9);
  const col = index % 9;
  return (row % 3) * 3 + (col % 3);
};

// Helper to get global index from sub-grid index and cell-in-sub-grid index
export const getGlobalIndex = (subGridIdx: number, cellIdx: number): number => {
  const subRow = Math.floor(subGridIdx / 3);
  const subCol = subGridIdx % 3;
  const cellRow = Math.floor(cellIdx / 3);
  const cellCol = cellIdx % 3;
  return (subRow * 3 + cellRow) * 9 + (subCol * 3 + cellCol);
};

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
  [0, 4, 8], [2, 4, 6]             // Diagonals
];

export const checkWinner = (cells: Player[]): Player => {
  for (const [a, b, c] of WIN_LINES) {
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) {
      return cells[a];
    }
  }
  return null;
};

export const isSubGridFull = (board: Board, subGridIdx: number): boolean => {
  for (let i = 0; i < 9; i++) {
    if (board[getGlobalIndex(subGridIdx, i)] === null) return false;
  }
  return true;
};

export const getLegalMoves = (state: GameState): number[] => {
  if (state.isGameOver) return [];
  
  const moves: number[] = [];
  if (state.activeSubGrid !== null) {
    // Must move in active sub-grid
    for (let i = 0; i < 9; i++) {
      const globalIdx = getGlobalIndex(state.activeSubGrid, i);
      if (state.board[globalIdx] === null) {
        moves.push(globalIdx);
      }
    }
  } else {
    // Can move anywhere that isn't won or full
    for (let s = 0; s < 9; s++) {
      if (state.subGridWinners[s] === null && !isSubGridFull(state.board, s)) {
        for (let i = 0; i < 9; i++) {
          const globalIdx = getGlobalIndex(s, i);
          if (state.board[globalIdx] === null) {
            moves.push(globalIdx);
          }
        }
      }
    }
  }
  return moves;
};

export const makeMove = (state: GameState, index: number): GameState => {
  if (state.board[index] !== null || state.isGameOver) return state;
  
  const newBoard = [...state.board];
  newBoard[index] = state.nextPlayer;
  
  const subGridIdx = getSubGridIndex(index);
  const subGridCells = Array(9).fill(null).map((_, i) => newBoard[getGlobalIndex(subGridIdx, i)]);
  
  const newSubGridWinners = [...state.subGridWinners];
  if (newSubGridWinners[subGridIdx] === null) {
    newSubGridWinners[subGridIdx] = checkWinner(subGridCells);
  }
  
  const globalWinner = checkWinner(newSubGridWinners);
  const isBoardFull = newBoard.every(cell => cell !== null);
  const noMoreMoves = getLegalMoves({
    ...state,
    board: newBoard,
    subGridWinners: newSubGridWinners,
    activeSubGrid: getCellInSubGridIndex(index),
    isGameOver: globalWinner !== null || isBoardFull
  }).length === 0;

  const nextActiveSubGrid = getCellInSubGridIndex(index);
  const isNextSubGridAvailable = newSubGridWinners[nextActiveSubGrid] === null && !isSubGridFull(newBoard, nextActiveSubGrid);

  return {
    board: newBoard,
    subGridWinners: newSubGridWinners,
    nextPlayer: state.nextPlayer === 'X' ? 'O' : 'X',
    activeSubGrid: isNextSubGridAvailable ? nextActiveSubGrid : null,
    winner: globalWinner,
    isGameOver: globalWinner !== null || isBoardFull || noMoreMoves
  };
};

// AI Evaluation Function
const POSITION_SCORES = [
  5, 2, 5,
  2, 10, 2,
  5, 2, 5
];

// Heuristic Evaluation Function
export const evaluate = (state: GameState): number => {
  if (state.winner === 'X') return 10000;
  if (state.winner === 'O') return -10000;
  if (state.isGameOver) return 0;

  let score = 0;

  // Weights
  const SUBGRID_WIN = 500;
  const CENTER_SUBGRID_WIN = 800;
  const FREE_MOVE_PENALTY = 1000;

  // 1. Sub-grid winners
  for (let i = 0; i < 9; i++) {
    if (state.subGridWinners[i] === 'X') {
      score += (i === 4 ? CENTER_SUBGRID_WIN : SUBGRID_WIN);
    } else if (state.subGridWinners[i] === 'O') {
      score -= (i === 4 ? CENTER_SUBGRID_WIN : SUBGRID_WIN);
    }
  }

  // 2. Position-based scoring for individual cells
  // Differentiates moves like E5 (center) from A1 (corner)
  for (let i = 0; i < 81; i++) {
    if (state.board[i] === 'X') {
      const cellIdxInSubGrid = getCellInSubGridIndex(i);
      const subGridIdx = getSubGridIndex(i);
      score += POSITION_SCORES[cellIdxInSubGrid];
      score += POSITION_SCORES[subGridIdx] * 2;
    } else if (state.board[i] === 'O') {
      const cellIdxInSubGrid = getCellInSubGridIndex(i);
      const subGridIdx = getSubGridIndex(i);
      score -= POSITION_SCORES[cellIdxInSubGrid];
      score -= POSITION_SCORES[subGridIdx] * 2;
    }
  }

  // 3. Penalty for giving opponent a free move
  // Only apply if the board is not empty (avoid first-move bias)
  const isBoardEmpty = state.board.every(cell => cell === null);
  if (state.activeSubGrid === null && !isBoardEmpty) {
    if (state.nextPlayer === 'X') score -= FREE_MOVE_PENALTY;
    else score += FREE_MOVE_PENALTY;
  }

  return score;
};

// Minimax with Alpha-Beta Pruning
export const minimax = (
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean
): number => {
  if (depth === 0 || state.isGameOver) {
    return evaluate(state);
  }

  const moves = getLegalMoves(state);
  
  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      const nextState = makeMove(state, move);
      const ev = minimax(nextState, depth - 1, alpha, beta, false);
      maxEval = Math.max(maxEval, ev);
      alpha = Math.max(alpha, ev);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      const nextState = makeMove(state, move);
      const ev = minimax(nextState, depth - 1, alpha, beta, true);
      minEval = Math.min(minEval, ev);
      beta = Math.min(beta, ev);
      if (beta <= alpha) break;
    }
    return minEval;
  }
};

export const getBestMove = (state: GameState, depth: number): { move: number, score: number } => {
  const moves = getLegalMoves(state);
  let bestMove = -1;
  let bestScore = state.nextPlayer === 'X' ? -Infinity : Infinity;

  for (const move of moves) {
    const nextState = makeMove(state, move);
    const score = minimax(nextState, depth - 1, -Infinity, Infinity, state.nextPlayer === 'O');
    
    if (state.nextPlayer === 'X') {
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    } else {
      if (score < bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
  }

  return { move: bestMove, score: bestScore };
};

export const getTopMoves = (state: GameState, depth: number, count: number = 3): { move: number, score: number }[] => {
  const moves = getLegalMoves(state);
  const moveScores = moves.map(move => {
    const nextState = makeMove(state, move);
    const score = minimax(nextState, depth - 1, -Infinity, Infinity, state.nextPlayer === 'O');
    return { move, score };
  });

  if (state.nextPlayer === 'X') {
    return moveScores.sort((a, b) => b.score - a.score).slice(0, count);
  } else {
    return moveScores.sort((a, b) => a.score - b.score).slice(0, count);
  }
};

export const indexToNotation = (index: number): string => {
  const subGridIdx = getSubGridIndex(index);
  const cellIdx = getCellInSubGridIndex(index);
  const subGridLetter = String.fromCharCode(65 + subGridIdx); // A-I
  const cellNumber = cellIdx + 1; // 1-9
  return `${subGridLetter}${cellNumber}`;
};

// Find if there is a forced win or loss in the immediate future
export const findForcedWin = (state: GameState, depth: number = 2): { move: number, winner: 'X' | 'O' } | null => {
  const moves = getLegalMoves(state);
  const player = state.nextPlayer;
  const opponent = player === 'X' ? 'O' : 'X';

  // Depth 1: Can I win now?
  for (const move of moves) {
    const next = makeMove(state, move);
    if (next.winner === player) return { move, winner: player };
  }

  if (depth > 1) {
    // Depth 2: Can I force a win or must I block a forced win?
    // This is a simplified check for "if I move here, can the opponent win on their next turn?"
    // If all moves lead to opponent winning, it's a forced loss.
    let movesThatDontLose = [];
    for (const move of moves) {
      const next = makeMove(state, move);
      const opponentMoves = getLegalMoves(next);
      let opponentCanWin = false;
      for (const opMove of opponentMoves) {
        const afterOp = makeMove(next, opMove);
        if (afterOp.winner === opponent) {
          opponentCanWin = true;
          break;
        }
      }
      if (!opponentCanWin) {
        movesThatDontLose.push(move);
      }
    }

    if (movesThatDontLose.length === 0 && moves.length > 0) {
      // All moves lead to immediate loss
      return { move: moves[0], winner: opponent };
    }
  }

  return null;
};

// Monte Carlo Simulation with Heuristic Playouts
export const runPlayout = (state: GameState): number => {
  let currentState = { ...state };
  let movesCount = 0;
  const MAX_MOVES = 100; // Reduced for speed, increased quality

  while (!currentState.isGameOver && movesCount < MAX_MOVES) {
    const moves = getLegalMoves(currentState);
    if (moves.length === 0) break;

    const player = currentState.nextPlayer;
    const opponent = player === 'X' ? 'O' : 'X';
    let chosenMove = -1;

    // 1. Immediate Win
    for (const move of moves) {
      const next = makeMove(currentState, move);
      if (next.winner === player) {
        chosenMove = move;
        break;
      }
    }

    // 2. Game Win Prevention (Defensive Play)
    if (chosenMove === -1) {
      const defensiveMoves = moves.filter(m => {
        const next = makeMove(currentState, m);
        const opMoves = getLegalMoves(next);
        // Check if opponent can win the game on their next turn
        return !opMoves.some(om => makeMove(next, om).winner === opponent);
      });
      
      if (defensiveMoves.length > 0 && defensiveMoves.length < moves.length) {
        // Only pick from moves that don't lead to an immediate loss
        chosenMove = defensiveMoves[Math.floor(Math.random() * defensiveMoves.length)];
      }
    }

    // 3. Subgrid Win Prevention (Secondary Defense)
    if (chosenMove === -1) {
      for (const move of moves) {
        const subIdx = getSubGridIndex(move);
        const subCells = Array(9).fill(null).map((_, i) => currentState.board[getGlobalIndex(subIdx, i)]);
        subCells[getCellInSubGridIndex(move)] = opponent;
        if (checkWinner(subCells) === opponent) {
          chosenMove = move;
          break;
        }
      }
    }

    // 4. Heuristic / Random
    if (chosenMove === -1) {
      if (Math.random() < 0.6) {
        let bestScore = -Infinity;
        let bestMove = moves[0];
        for (const move of moves) {
          const next = makeMove(currentState, move);
          const s = evaluate(next) * (player === 'X' ? 1 : -1);
          if (s > bestScore) {
            bestScore = s;
            bestMove = move;
          }
        }
        chosenMove = bestMove;
      } else {
        chosenMove = moves[Math.floor(Math.random() * moves.length)];
      }
    }

    currentState = makeMove(currentState, chosenMove);
    movesCount++;
  }

  if (currentState.winner === 'X') return 1;
  if (currentState.winner === 'O') return -1;
  return 0;
};

export interface SimulationResult {
  winsX: number;
  winsO: number;
  draws: number;
  total: number;
  moveScores: Record<number, { wins: number, total: number }>;
}

export const getInitialSimResult = (): SimulationResult => ({
  winsX: 0,
  winsO: 0,
  draws: 0,
  total: 0,
  moveScores: {},
});
