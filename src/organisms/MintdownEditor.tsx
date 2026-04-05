// -- Type Imports --

interface MintdownEditorProps {
   value:    string
   onChange: (text: string) => void
}

// #############
// # Component #
// #############

export function MintdownEditor({ value, onChange }: MintdownEditorProps) {
   return (
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
         <textarea
            className="flex-1 w-full resize-none bg-transparent text-text font-mono text-sm leading-relaxed p-8 outline-none border-0"
            value={value}
            onChange={event => onChange(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
         />
      </div>
   )
}
