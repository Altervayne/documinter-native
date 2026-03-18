export interface TokenRule {
   type: string
   pattern: RegExp
}

export interface Language {
   name: string
   rules: TokenRule[]
}
