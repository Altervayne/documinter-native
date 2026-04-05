import type { Language } from '../types'

// Control flow
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

// Declarations
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

// Logical / comparison operators
const KEYWORDS_LOGIC = [
   '_ET_', 'ET', '_OU_', 'OU', 'NON', 'OUX',  
   'EN',                                      
   'DANS',                                    
   'PAS', 'A', '_A_', 'À', '_À_',             
]

// Boolean / null / empty literals
const KEYWORDS_BOOL = [
   'Vrai', 'Faux', 'VRAI', 'FAUX',
   'Null', 'NULL', 'Nul', 'NUL',
   'Vide', 'VIDE',
]

// Built-in types
const TYPES = [
   // Declarations
   'est', 'sont', 'un', 'des',
   // Numeric
   'entier', 'réel', 'reel', 'numérique', 'numerique', '1 octet', '2 octets', '3 octets', '4 octets', '5 octets', '6 octets', '7 octets', '8 octets',
   'sur 1', 'sur 2', 'sur 3', 'sur 4', 'sur 5', 'sur 6', 'sur 7', 'sur 8', 'signé', 'non signé',
   // String
   'chaîne', 'chaine', 'caractère',
   // Boolean
   'booléen', 'booleen', 'logique',
   // Date / time
   'DateHeure', 'Date', 'Heure', 'Durée', 'Duree',
   // Collections / generic
   'Tableau', 'tableau', 'tableau associatif', 'Variant', 'JSON',
   // Currency
   'Monnaie', 'monnaie', 'Devise', 'devise',
   // OOP / memory
   'Objet', 'Pointeur', 'dynamique', 'libérer', 'allouer',
   // Callable type
   'Procédure', 'Procedure',
   // Data access
   'Connexion', 'Requête', 'Requete',
   // UI
   'Fenêtre', 'Fenetre', 'Champ'
]

// ==============================================================================
// Build combined patterns (longest alternative first to prevent partial matches)
// ==============================================================================
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
