import type { Language } from '../types'

const KEYWORDS_FLOW = [
   'SI', 'ALORS', 'SINON', 'SINONSI',
   'POUR', 'TOUT', 'TOUTE', 'LIGNE', 'DE', '_À_', 'À',
    '_A_', 'A', 'PAS', 'FAIRE', 'AVEC',
   'TANTQUE',
   'SELON', 'BASCULE', 'CAS', 'AUTRECAS',
   'SORTIR', 'CONTINUE',
   'FIN',
   'ESSAI', 'SAUF', 'EXCEPTION', 'QUAND',
   'DÉCLENCHER', 'DECLENCHER', 'DANS', 'FAIRE',
   'RETOUR', 'RENVOYER',
]

const KEYWORDS_DECL = [
   'PROCÉDURE', 'PROCEDURE',
   'FONCTION', 'FUNCTION',
   'LOCAL', 'GLOBAL', 'STATIQUE',
   'CONSTANTE', 'CONSTANT', 'Structure',
   'CLASSE', 'HÉRITE', 'HERITE',
   'MÉTHODE', 'METHODE',
   'ATTRIBUT', 'CONSTRUCTEUR', 'DESTRUCTEUR',
   'VIRTUEL', 'ABSTRAIT',
   'PUBLIQUE', 'PROTÉGÉ', 'PROTEGE', 'PRIVÉ', 'PRIVE',
   'INTERNE', 'EXTERNE',
]

const KEYWORDS_LOGIC = [
   '_ET_', 'ET', '_OU_', 'OU', 'NON', 'OUX',  
   'EN',                                      
   'DANS',                                    
   'PAS', 'A', '_A_', 'À', '_À_',             
]

const KEYWORDS_BOOL = [
   'Vrai', 'Faux', 'VRAI', 'FAUX',
   'Null', 'NULL', 'Nul', 'NUL',
   'Vide', 'VIDE',
]

const TYPES = [
   'est', 'sont', 'un', 'des', 'une',
   'entier', 'réel', 'reel', 'numérique', 'numerique', '1 octet', '2 octets', '3 octets', '4 octets', '5 octets', '6 octets', '7 octets', '8 octets',
   'sur 1', 'sur 2', 'sur 3', 'sur 4', 'sur 5', 'sur 6', 'sur 7', 'sur 8', 'signé', 'non signé',
   'chaîne', 'chaine', 'caractère',
   'booléen', 'booleen', 'logique',
   'DateHeure', 'Date', 'Heure', 'Durée', 'Duree',
   'Tableau', 'tableau', 'tableau associatif', 'Variant', 'JSON',
   'Monnaie', 'monnaie', 'Devise', 'devise',
   'Objet', 'Pointeur', 'dynamique', 'libérer', 'allouer',
   'Procédure', 'Procedure',
   'Connexion', 'Requête', 'Requete',
   'Fenêtre', 'Fenetre', 'Champ'
]

// ##################################################################################
// # BUILD COMBINED PATTERNS (LONGEST ALTERNATIVE FIRST TO PREVENT PARTIAL MATCHES) #
// ##################################################################################
function escRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

const allKw = [...KEYWORDS_DECL, ...KEYWORDS_FLOW, ...KEYWORDS_LOGIC, ...KEYWORDS_BOOL]
   .sort((a, b) => b.length - a.length)

const kwSource   = allKw.map(escRe).join('|')
const typeSource = TYPES.map(escRe).join('|')

export const windev: Language = {
   name: 'windev',
   rules: [
      { type: 'cmt',  pattern: /\/\/[^\n]*/  },
      { type: 'str',  pattern: /"(?:[^"\\]|\\.)*"/ },
      { type: 'str',  pattern: /'(?:[^'\\]|\\.)*'/ },

      // WLangage uses a comma or a dot as the decimal separator.
      { type: 'num',  pattern: /\b\d+[.,]?\d*\b/ },

      // Types before keywords, so a type word is not mis-tagged as a keyword.
      { type: 'type', pattern: new RegExp(`\\b(${typeSource})\\b`) },
      { type: 'kw',   pattern: new RegExp(`\\b(${kwSource})\\b`) },
      { type: 'fn',   pattern: /\b([A-Za-zÀ-öø-ÿ_][\wÀ-öø-ÿ]*)\s*(?=\()/ },
      { type: 'op',   pattern: /:=|<>|<=|>=|[=<>+\-*/%[\]{}]/ },
   ],
}
