/**
 * WinDev / WLangage syntax highlighting rules.
 *
 * HOW TO EXTEND:
 * - Add keywords to the appropriate array below (all arrays are plain string lists).
 * - Add types to TYPES.
 * - Each entry is matched as a whole word (\b boundary anchored).
 * - Rules run in order — higher-priority rules must come first.
 *   Current order: comments → strings → numbers → types → keywords → functions → operators
 */

import type { Language } from '../types'

// ── Control flow ──────────────────────────────────────────────────────────────
const KEYWORDS_FLOW = [
  // Conditionals
  'SI', 'ALORS', 'SINON', 'SINONSI',
  // For loop
  'POUR', 'TOUT', 'TOUTE', 'LIGNE', 'DE', '_À_', 'À',
   '_A_', 'A', 'PAS', 'FAIRE', 'AVEC',
  // While
  'TANTQUE',
  // Switch/case
  'SELON', 'BASCULE', 'CAS', 'AUTRECAS',
  // Loop control
  'SORTIR', 'CONTINUE',
  // Generic block end
  'FIN',
  // Error handling
  'ESSAI', 'SAUF', 'EXCEPTION', 'QUAND',
  'DÉCLENCHER', 'DECLENCHER', 'DANS', 'FAIRE',
  // Return
  'RETOUR', 'RENVOYER',
]

// ── Declarations ──────────────────────────────────────────────────────────────
const KEYWORDS_DECL = [
  // Functions / procedures
  'PROCÉDURE', 'PROCEDURE',
  'FONCTION', 'FUNCTION',
  // Scope
  'LOCAL', 'GLOBAL', 'STATIQUE',
  // Constants
  'CONSTANTE', 'CONSTANT',
  // OOP — class & inheritance
  'CLASSE', 'HÉRITE', 'HERITE',
  // OOP — members
  'MÉTHODE', 'METHODE',
  'ATTRIBUT', 'CONSTRUCTEUR', 'DESTRUCTEUR',
  // OOP — modifiers
  'VIRTUEL', 'ABSTRAIT',
  // Access modifiers
  'PUBLIQUE', 'PROTÉGÉ', 'PROTEGE', 'PRIVÉ', 'PRIVE',
  'INTERNE', 'EXTERNE',
]

// ── Logical / comparison operators (keywords in WLangage) ────────────────────
const KEYWORDS_LOGIC = [
  '_ET_', 'ET', '_OU_', 'OU', 'NON', 'OUX',   // AND, OR, NOT, XOR
  'EN',                                      // type cast:  valeur EN entier
  'DANS',                                    // membership: valeur DANS tableau
  'PAS',                                     // step (also appears in POUR loop)
]

// ── Boolean / null / empty literals ──────────────────────────────────────────
const KEYWORDS_BOOL = [
  'Vrai', 'Faux', 'VRAI', 'FAUX',
  'Null', 'NULL', 'Nul', 'NUL',
  'Vide', 'VIDE',
]

// ── Built-in types ────────────────────────────────────────────────────────────
const TYPES = [
  // Numeric
  'entier', 'réel', 'reel', 'numérique', 'numerique', 'octet',
  // String
  'chaîne', 'chaine',
  // Boolean
  'booléen', 'booleen', 'logique',
  // Date / time
  'DateHeure', 'Date', 'Heure', 'Durée', 'Duree',
  // Collections / generic
  'Tableau', 'tableau', 'Variant',
  // Currency
  'Monnaie', 'monnaie', 'Devise', 'devise',
  // OOP / memory
  'Objet', 'Pointeur',
  // Callable type
  'Procédure', 'Procedure',
  // Data access
  'Connexion', 'Requête', 'Requete',
  // UI
  'Fenêtre', 'Fenetre',
]

// ─────────────────────────────────────────────────────────────────────────────
// Build combined patterns (longest alternative first to prevent partial matches)
// ─────────────────────────────────────────────────────────────────────────────

function escRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

const allKw = [...KEYWORDS_DECL, ...KEYWORDS_FLOW, ...KEYWORDS_LOGIC, ...KEYWORDS_BOOL]
  .sort((a, b) => b.length - a.length)

const kwSource   = allKw.map(escRe).join('|')
const typeSource = TYPES.map(escRe).join('|')

export const windev: Language = {
  name: 'windev',
  rules: [
    // Line comments  ( // … )
    { type: 'cmt',  pattern: /\/\/[^\n]*/  },

    // Strings — double-quoted (primary) and single-quoted
    { type: 'str',  pattern: /"(?:[^"\\]|\\.)*"/ },
    { type: 'str',  pattern: /'(?:[^'\\]|\\.)*'/ },

    // Numbers — integer and decimal (WLangage uses comma or dot as decimal sep)
    { type: 'num',  pattern: /\b\d+[.,]?\d*\b/ },

    // Built-in types (before keyword rule to avoid mis-classification)
    { type: 'type', pattern: new RegExp(`\\b(${typeSource})\\b`) },

    // Keywords (case-sensitive — WLangage uses uppercase for control/declarations)
    { type: 'kw',   pattern: new RegExp(`\\b(${kwSource})\\b`) },

    // Function / procedure calls: identifier immediately followed by (
    { type: 'fn',   pattern: /\b([A-Za-zÀ-öø-ÿ_][\wÀ-öø-ÿ]*)\s*(?=\()/ },

    // Operators: assignment :=  comparison <> <= >=  and common arithmetic/brackets
    { type: 'op',   pattern: /:=|<>|<=|>=|[=<>+\-*/%[\]{}]/ },
  ],
}
