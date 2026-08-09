// ###############################################################################################
// # PANEL REGISTRY                                                                              #
// #                                                                                             #
// # The catalog of dockable side panels: their identity (icon + title), their applicability to  #
// # the current document, and their default dock side. This is metadata only. The rendered      #
// # panel bodies are supplied by App to DockHost as a Record<PanelId, ReactNode>, the same way   #
// # App feeds the center panes to WorkspaceLayout, so a body can be hosted by a dock tab today   #
// # or a floating window later without the registry owning any React render logic.              #
// #                                                                                             #
// # Adding a panel is a new entry here plus a body wired in App. No dock chrome changes.         #
// ###############################################################################################

// -- Icon Imports --
import { PanelsTopLeft, BookOpen, Anchor, Ruler, Image as ImageIcon, PanelLeft } from 'lucide-react'
import type { ReactNode } from 'react'

// -- Type Imports --
import type { PanelId, DockSide } from './dockLayout'
import type { PageKind } from './format'
import type { T } from './i18n'

// #########
// # TYPES #
// #########

/** What a panel's `isApplicable` needs about the active document. Grows as panels need more context. */
export interface PanelContext {
   /** The active document's page-format kind, so Pages can require a paged (A4) document. */
   formatKind: PageKind
   /** True in preview (read-only) mode, where the page-editing sorter has nothing to act on. */
   readOnly:   boolean
}

export interface PanelDescriptor {
   id:    PanelId
   /** Identity on tabs and the collapsed rail. */
   icon:  ReactNode
   /** Localized panel title. */
   title: (t: T) => string
   /** Whether the panel can be shown for the current document. An inapplicable panel is force-undocked
    *  (and remembered) by the dock policy, and hidden from the panel toggles. */
   isApplicable: (context: PanelContext) => boolean
   /** Side the panel first docks to when it has never been placed (Structure left, Pages right). */
   defaultSide: DockSide
   /** Whether the panel may be popped out into a floating window. */
   canFloat: boolean
   /** Whether the panel auto-docks the first time it applies (Structure / Pages / Anchors do). A
    *  default-closed panel never auto-opens: it stays hidden until the user reveals it, even though it
    *  is applicable. The settings-editor panels (Page setup, Presentation, Document nav) are all
    *  default-closed so they do not clutter a fresh document with three open editors. */
   defaultOpen: boolean
}

// ############
// # REGISTRY #
// ############

export const PANEL_REGISTRY: Record<PanelId, PanelDescriptor> = {
   structure: {
      id:           'structure',
      icon:         <PanelsTopLeft size={16} />,
      title:        translations => translations.structure,
      isApplicable: () => true,
      defaultSide:  'left',
      canFloat:     true,
      defaultOpen:  true,
   },
   pages: {
      id:           'pages',
      icon:         <BookOpen size={16} />,
      title:        translations => translations.pageSorterTitle,
      // Pages only makes sense for a paged (A4) document being edited; an infinite canvas has no
      // discrete pages, and preview mode has nothing for the sorter to reorder.
      isApplicable: context => context.formatKind !== 'infinite' && !context.readOnly,
      defaultSide:  'right',
      canFloat:     true,
      defaultOpen:  true,
   },
   anchors: {
      id:           'anchors',
      icon:         <Anchor size={16} />,
      title:        translations => translations.anchorsPanel,
      // A navigation aid: it lists every deep-link handle in the document, so it is useful in any
      // format and in preview too (navigation still works read-only).
      isApplicable: () => true,
      defaultSide:  'left',
      canFloat:     true,
      defaultOpen:  true,
   },
   pagesetup: {
      id:           'pagesetup',
      icon:         <Ruler size={16} />,
      title:        translations => translations.formatWindowTitle,
      // Editing surface, not a preview aid: the format controls only mean something while the document
      // is being edited, so it is applicable outside read-only (preview) mode.
      isApplicable: context => !context.readOnly,
      defaultSide:  'right',
      canFloat:     true,
      defaultOpen:  false,
   },
   presentation: {
      id:           'presentation',
      icon:         <ImageIcon size={16} />,
      title:        translations => translations.presentationWindowTitle,
      isApplicable: context => !context.readOnly,
      defaultSide:  'right',
      canFloat:     true,
      defaultOpen:  false,
   },
   documentnav: {
      id:           'documentnav',
      icon:         <PanelLeft size={16} />,
      title:        translations => translations.navigationWindowTitle,
      isApplicable: context => !context.readOnly,
      defaultSide:  'right',
      canFloat:     true,
      defaultOpen:  false,
   },
}

/** All registered panel ids, in a stable order (used to iterate the catalog). */
export const ALL_PANEL_IDS: PanelId[] = Object.keys(PANEL_REGISTRY) as PanelId[]

/** The subset of panels applicable to the current document. */
export function applicablePanels(context: PanelContext): PanelId[] {
   return ALL_PANEL_IDS.filter(panelId => PANEL_REGISTRY[panelId].isApplicable(context))
}

/** The registry's default-side lookup, in the shape the dock policy expects. */
export const DEFAULT_PANEL_SIDES: Record<PanelId, DockSide> = {
   structure:    PANEL_REGISTRY.structure.defaultSide,
   pages:        PANEL_REGISTRY.pages.defaultSide,
   anchors:      PANEL_REGISTRY.anchors.defaultSide,
   pagesetup:    PANEL_REGISTRY.pagesetup.defaultSide,
   presentation: PANEL_REGISTRY.presentation.defaultSide,
   documentnav:  PANEL_REGISTRY.documentnav.defaultSide,
}

/** The panels that auto-dock the first time they apply, derived from each descriptor's `defaultOpen`.
 *  The dock policy consults this so a default-closed panel with no prior memory is never auto-opened. */
export const PANELS_DEFAULT_OPEN: Set<PanelId> = new Set(
   ALL_PANEL_IDS.filter(panelId => PANEL_REGISTRY[panelId].defaultOpen),
)
