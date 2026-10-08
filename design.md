# HMS UI Design System — FrontDesk Portal Standard

> **This document is the single source of truth for HMS UI.**
> FrontDesk portal UI is the **final, approved design** for all portals.
> Every portal — SuperAdmin, Admission, Inventory, Admin — **MUST** follow these exact specs. No deviation allowed.

---

## 1. Typography

### Font Family

| Portal | Font | Weight Default | HTML Class |
|---|---|---|---|
| **FrontDesk** | Inter | 400 | portal-inter |
| **SuperAdmin / Admin / Inventory / Admission** | Montserrat | 500 (body) | portal-montserrat |

> **Rule:** Both fonts are from Google Fonts. Inter for FrontDesk only. All other portals use Montserrat. Placeholders stay font-weight 400 in Montserrat portals.

### Type Scale

| Use | Class | Size | Weight |
|---|---|---|---|
| Page heading h1 | text-xl font-bold text-[#111827] | 20px | 700 |
| Section heading | text-base font-bold text-slate-900 | 16px | 700 |
| Card label | text-[11px] font-bold text-slate-500 uppercase tracking-wider | 11px | 700 |
| Card value | text-lg sm:text-xl font-extrabold text-slate-900 tabular-nums | 18-20px | 800 |
| Table header th | text-xs font-bold text-slate-700 uppercase tracking-wider | 12px | 700 |
| Table cell td | text-xs text-slate-700 | 12px | 400 |
| Body text / subtitles | text-xs text-[#52665e] leading-relaxed | 12px | 400 |
| Badge / pill text | text-[11px] font-semibold | 11px | 600 |
| Micro label | text-[10px] text-slate-400 | 10px | 400 |
| Mono numbers | font-mono font-bold tabular-nums | — | 700 |

> **Rule:** Never use text-sm (14px) in table cells, badges, labels, or toolbars. text-xs (12px) is the standard body size. font-mono tabular-nums is mandatory for all PKR amounts and numeric IDs.

---

## 2. Color Palette

### Brand / Primary (Emerald Green)

```
Primary:        #129b70   (buttons, links, active states)
Primary Hover:  #0e7d5a   (button hover)
Primary Dark:   #08775A   (table header strip bg, icons)
Primary Soft:   #effaf5   (soft bg for badges/icons/KPI)
Primary Border: #c2e7db   (soft border for green-accented elements)
```

### Page and Surface Colors

```
Page Background:  #f6f8f7    (body background - light grey-green)
Card Background:  #ffffff    (all cards, table containers)
Border Color:     #e2eae5    (all card/component borders)
Input Border:     #c2e7db    (form input borders)
Hover BG:         #f0faf6    (row / nav item hover)
Muted BG:         #f6faf8    (search bars, date pickers)
Table Header BG:  #f8fafc    (thead row background)
Table Row Hover:  #f8faf9    (table row hover)
```

### Sidebar Colors

```
Sidebar BG:         #ffffff    (white sidebar - NOT dark)
Sidebar Border:     #e2eae5
Sidebar Nav Text:   #2d3748
Sidebar Secondary:  #52665e    (muted text, icons)
Active Item BG:     #dff5ea
Active Item Text:   #0e7d5a
Active Item Border: border-l-2 border-[#129b70]
Active Icon:        #129b70
Group Label:        #8b9e95 uppercase tracking-widest text-[10px]
Logout Button:      rose-700 bg-rose-50 border-rose-200
```

### Text Colors

```
Primary Text:   #111827   (headings, strong labels)
Secondary Text: #52665e   (body text, subtitles, helper text)
Muted Text:     #8b9e95   (placeholders, disabled)
Table Cell:     slate-700
```

### Status / Semantic Colors

| Semantic | Background | Text | Border | Dot |
|---|---|---|---|---|
| Success / Paid / Active | bg-green-50 | text-green-700 | border-green-200 | bg-green-600 |
| Admitted | bg-[#effaf5] | text-[#08775A] | border-[#c2e7db] | bg-[#149E75] animate-pulse |
| Warning / Pending | bg-amber-50 | text-amber-700 | border-amber-200 | bg-amber-600 |
| Danger / Unpaid | bg-rose-50 | text-rose-700 | border-rose-200 | bg-rose-600 |
| Inactive / Discharged | bg-slate-100 | text-slate-600 | border-slate-200 | bg-slate-400 |
| Info / Blue | bg-blue-50 | text-blue-700 | border-blue-200 | bg-blue-600 |
| Indigo | bg-indigo-50 | text-indigo-700 | border-indigo-200 | — |

### Care-Type / Queue Badge Colors

| Queue | Background | Text | Border |
|---|---|---|---|
| OPD | bg-slate-100 | text-slate-700 | border-slate-200 |
| Emergency (ER) | bg-rose-50 | text-rose-700 | border-rose-200 |
| Observation (OBS) | bg-indigo-50 | text-indigo-700 | border-indigo-200 |
| Admission (ADM) | bg-[#effaf5] | text-[#08775A] | border-[#c2e7db] |
| Custom Billing | bg-amber-50 | text-amber-700 | border-amber-200 |

---

## 3. Spacing and Layout

```
Page wrapper:      space-y-4             (stacked sections, 16px gap between all blocks)
Content Padding:   px-4 sm:px-6 py-5    (via AppLayout)
Sidebar offset:    lg:pl-64 expanded / lg:pl-20 collapsed

Border Radius:
  Cards:             rounded-2xl   (16px)
  Toolbars/Filters:  rounded-xl    (12px)
  Buttons:           rounded-lg    (8px)
  Status Badges:     rounded-md
  Pills:             rounded-full
  Inputs:            rounded-lg    (8px)
  Table Container:   rounded-2xl
  Modal:             rounded-xl

Shadows:
  Card:            shadow-[0_2px_8px_rgba(0,0,0,0.03)]
  Toolbar/Panel:   shadow-2xs
  Button small:    shadow-2xs
  Modal:           shadow-2xl
  Table container: shadow-[0_1px_4px_rgba(0,0,0,0.04)]
```

---

## 4. Component Patterns

### 4.1 Page Header Block

Every view starts with a white header card containing the page title, subtitle, and action buttons.

```tsx
<div className="bg-white rounded-xl border border-[#e2eae5] p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
  <div>
    <div className="flex items-center gap-2 mb-1">
      <h1 className="text-xl font-bold text-[#111827]">{title}</h1>
      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#effaf5] text-[#08775A] border border-[#c2e7db]">
        Live Badge Label
      </span>
    </div>
    <p className="text-xs text-[#52665e] max-w-2xl leading-relaxed">{subtitle}</p>
  </div>
  <div className="flex items-center gap-2 self-start md:self-auto">
    <button className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer">
      Refresh
    </button>
    <button className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#129b70] hover:bg-[#0e7d5a] text-white text-xs font-bold rounded-lg shadow-xs transition-colors cursor-pointer">
      Add New
    </button>
  </div>
</div>
```

---

### 4.2 KPI / Stat Cards (HospitalKpiHeader)

KPI cards are always a grid (2 cols mobile, 4 cols desktop). Each card has a colored top border, an icon box, label, and a large bold value.

```tsx
<div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
  <div className="bg-white rounded-2xl border border-slate-200/80 border-t-[3.5px] border-t-[#08775A] shadow-[0_2px_8px_rgba(0,0,0,0.03)] p-4 sm:p-5 flex items-center gap-3.5 hover:shadow-md transition-all">
    <div className="h-11 w-11 rounded-xl flex items-center justify-center border shrink-0 bg-[#effaf5] text-[#0e7d5a] border-[#c2e7db]">
      <Icon className="h-5 w-5" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">Card Label</div>
      <div className="text-lg sm:text-xl font-extrabold text-slate-900 truncate tabular-nums mt-0.5">Value</div>
      <div className="text-[10px] text-slate-400 truncate mt-0.5">Subtitle / helper text</div>
    </div>
  </div>
</div>
```

#### KPI Card border-t accent colors by tone

| Tone | border-t | Icon BG | Icon Text | Icon Border |
|---|---|---|---|---|
| default (green) | border-t-[#08775A] | bg-[#effaf5] | text-[#08775A] | border-[#c2e7db] |
| success | border-t-emerald-600 | bg-emerald-50 | text-emerald-700 | border-emerald-200 |
| danger | border-t-rose-600 | bg-rose-50 | text-rose-700 | border-rose-200 |
| warning | border-t-amber-500 | bg-amber-50 | text-amber-700 | border-amber-200 |
| info | border-t-blue-600 | bg-blue-50 | text-blue-700 | border-blue-200 |
| indigo | border-t-indigo-600 | bg-indigo-50 | text-indigo-700 | border-indigo-200 |
| sky | border-t-sky-600 | bg-sky-50 | text-sky-700 | border-sky-200 |

---

### 4.3 Segmented Tab / Queue Selector

```tsx
<div className="bg-white rounded-xl border border-[#e2eae5] p-2 shadow-2xs">
  <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
    {TABS.map((tab) => {
      const isActive = activeTab === tab.key;
      return (
        <button
          key={tab.key}
          onClick={() => setActiveTab(tab.key)}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all shrink-0 cursor-pointer ${
            isActive
              ? 'bg-[#08775A] text-white shadow-xs'
              : 'bg-[#f8faf9] text-[#52665e] hover:bg-[#eff5f2] hover:text-[#111827] border border-[#e2eae5]'
          }`}
        >
          <span>{tab.label}</span>
          <span className={`px-1.5 rounded-full text-[10px] font-bold ${
            isActive ? 'bg-white/20 text-white' : 'bg-white text-[#08775A] border border-[#c2e7db]'
          }`}>
            {count}
          </span>
        </button>
      );
    })}
  </div>
</div>
```

---

### 4.4 Filter Toolbar

Container: `bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs`

```tsx
<div className="bg-white rounded-xl border border-[#e2eae5] p-3 shadow-2xs">
  <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2.5">

    {/* Search Box */}
    <div className="relative flex-1 min-w-[220px]">
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#8b9e95]" />
      <input
        type="text"
        placeholder="Search..."
        className="w-full text-xs pl-9 pr-7 py-2 border border-[#c2e7db] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#08775A] focus:border-[#08775A] bg-white placeholder:text-[#8b9e95]"
      />
    </div>

    {/* Date Range Picker */}
    <div className="flex items-center gap-1.5 bg-[#f8faf9] px-2.5 py-1.5 rounded-lg border border-[#c2e7db] shrink-0">
      <span className="text-[11px] font-semibold text-[#52665e]">From:</span>
      <input type="date" className="text-xs px-1.5 py-1 bg-white border border-[#c2e7db] rounded-md text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#08775A]" />
      <span className="text-[11px] font-semibold text-[#52665e]">To:</span>
      <input type="date" className="text-xs px-1.5 py-1 bg-white border border-[#c2e7db] rounded-md text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#08775A]" />
      <button className="text-[10px] px-2 py-1 rounded font-semibold border border-[#c2e7db] text-[#08775A] bg-white hover:bg-[#effaf5] cursor-pointer">Today</button>
    </div>

    {/* Select Dropdown */}
    <select className="text-xs px-2.5 py-2 border border-[#c2e7db] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#08775A] text-[#111827] font-medium cursor-pointer">
      <option>All</option>
    </select>

    {/* Reset Button */}
    <button className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer shrink-0">
      Reset
    </button>
  </div>
</div>
```

---

### 4.5 Data Table

Container: `bg-white rounded-2xl border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden`

**Structure:** Dark emerald header strip (#0e5944) -> sub-header row -> scroll container with sticky thead -> pagination bar.

```
DARK EMERALD HEADER STRIP:
  bg-[#0e5944] text-white px-4 py-2.5
  Left: Icon (text-emerald-300 h-4 w-4) + Title (font-bold text-xs sm:text-sm) + Count badge
  Count badge: bg-emerald-700/60 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-500/30 text-[10px] font-semibold
  Right: Export buttons (Excel #16a34a | CSV #0284c7 | PDF #dc2626 | Print slate-800)
  Export button class: inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-white text-xs font-semibold shadow-xs cursor-pointer

SUB-HEADER ROW:
  px-3.5 py-2 bg-slate-50/70 border-b border-slate-200
  Left: "Showing X of Y records" text-xs text-slate-600 font-medium
  Right: Per page select (10/15/25/50/100) bg-white border border-slate-200 rounded-md px-2 py-0.5

SCROLL CONTAINER:
  overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] min-h-[320px]

THEAD:
  bg-[#f8fafc] text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200
  uppercase tracking-wider select-none text-xs
  th: py-3 px-4 border-r border-slate-200 whitespace-nowrap
  th index (#): py-3 px-3.5 text-center border-r border-slate-200 w-12
  th right-aligned: text-right

TBODY:
  divide-y divide-slate-100 text-slate-700
  Row: hover:bg-slate-50/80 transition-colors cursor-pointer group

PAGINATION BAR:
  px-4 py-3 bg-slate-50/80 border-t border-slate-200
  Left: "Page X of Y" text-xs text-slate-600
  Right: Previous / Next buttons (px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 font-semibold shadow-2xs)
```

#### Table td Type-Specific Patterns

| Column Type | Classes |
|---|---|
| Row Index (#) | py-3.5 px-3.5 text-center border-r border-slate-100 text-slate-500 font-semibold font-mono whitespace-nowrap |
| Reference / ID | py-3.5 px-4 border-r border-slate-100 font-mono font-bold text-slate-900 group-hover:text-[#08775A] whitespace-nowrap |
| Name / Primary Text | py-3.5 px-4 border-r border-slate-100 font-semibold text-slate-900 whitespace-nowrap |
| Secondary sub-text | block mt-0.5 font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 rounded border border-slate-200 |
| Amount Positive | py-3.5 px-4 border-r border-slate-100 text-right font-mono font-bold text-emerald-700 whitespace-nowrap |
| Amount Due / Red | text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 |
| Amount Muted | text-right font-mono text-slate-500 |
| Date | py-3.5 px-4 border-r border-slate-100 text-right text-[11px] text-slate-500 whitespace-nowrap |
| Center | text-center |

---

### 4.6 Status / Category Badges

#### Status Badge (dot + text)

```tsx
<span className="inline-flex items-center gap-1.5 rounded-md border whitespace-nowrap tracking-tight px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
  <span className="inline-block h-1.5 w-1.5 rounded-full shrink-0 bg-emerald-600" />
  Active
</span>
```

#### Inline Badge (no dot)

```tsx
<span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-[#effaf5] text-[#08775A] border border-[#c2e7db] whitespace-nowrap">
  Admitted
</span>
```

---

### 4.7 Buttons

#### Primary (Green)
```
bg-[#129b70] hover:bg-[#0e7d5a] text-white text-xs font-bold rounded-lg shadow-xs px-3.5 py-2
```

#### Secondary / Ghost
```
bg-white hover:bg-[#f6faf8] text-[#52665e] hover:text-[#111827] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs px-3 py-2
```

#### Table Row Action - View
```
bg-white hover:bg-slate-800 text-slate-700 hover:text-white border border-slate-200 hover:border-slate-800 text-[11px] font-semibold rounded shadow-2xs px-2 py-1
```

#### Table Row Action - Primary (Pay, Approve)
```
bg-[#effaf5] hover:bg-[#08775A] text-[#08775A] hover:text-white border border-[#c2e7db] hover:border-[#08775A] text-[11px] font-semibold rounded shadow-2xs px-2 py-1
```

#### Table Row Action - Danger (Delete, Refund)
```
bg-white hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 hover:border-rose-600 text-[11px] font-semibold rounded shadow-2xs px-2 py-1
```

#### Destructive Standalone
```
bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-xs px-4 py-2
```

All buttons: `inline-flex items-center gap-1[.5] transition-colors cursor-pointer`

---

### 4.8 Form Inputs

```
Text Input:
  border border-[#c2e7db] rounded-lg text-xs px-3 py-2 bg-white
  focus:outline-none focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A]
  placeholder:text-[#8b9e95]

Select:
  border border-[#c2e7db] rounded-lg text-xs px-2.5 py-2 bg-white
  focus:outline-none focus:ring-2 focus:ring-[#08775A]
  text-[#111827] font-medium cursor-pointer

Label:
  block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1

Helper text:
  text-[10px] text-slate-400 mt-1
```

---

### 4.9 Modal

```
Backdrop:  fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4

Dialog:    relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200
           overflow-hidden flex flex-col max-h-[90vh]
           animate-in fade-in zoom-in-95 duration-150

Header:    flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/50
  Title:   text-base font-semibold text-slate-900
  Subtitle: text-xs text-slate-500 mt-0.5
  Close btn: rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100

Body:      px-6 py-4 overflow-y-auto flex-1 text-sm text-slate-700

Footer:    px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2.5
  Cancel:  px-4 py-2 text-xs font-semibold rounded-lg text-slate-700 bg-white border border-slate-300 hover:bg-slate-50
  Confirm: px-4 py-2 text-xs font-semibold rounded-lg bg-[#149E75] hover:bg-[#08775A] text-white shadow-xs
```

---

### 4.10 Sidebar

```
Width expanded:  w-64 (256px)
Width collapsed: w-20 (80px)
Background:      bg-white  (NOT dark)
Border:          border-r border-[#e2eae5]
Position:        fixed top-0 bottom-0 left-0
Transition:      transition-all duration-200 ease-in-out

Brand Header (h-14):
  bg-white, border-b border-[#e2eae5]
  Logo fallback: w-8 h-8 rounded-lg bg-[#129b70] text-white font-bold text-xs
  Hospital name: text-xs font-bold text-[#111827] uppercase tracking-wider
  HMS subtitle:  text-[10px] text-[#52665e] font-medium

Quick Search:
  Container: px-3 pt-3 pb-1
  Input: bg-[#f6faf8] border border-[#e2eae5] text-xs rounded-lg
  Focus: focus:ring-[#129b70]/20 focus:border-[#129b70]

Nav Group Label:
  text-[10px] font-bold text-[#8b9e95] uppercase tracking-widest px-3 py-1

Nav Item inactive:
  text-[#2d3748] text-xs, hover:bg-[#f0faf6] hover:text-[#111827]
  icon: text-[#52665e] h-4 w-4, gap-3 px-3 py-1.5 rounded-lg

Nav Item active:
  bg-[#dff5ea] text-[#0e7d5a] font-semibold
  border-l-2 border-[#129b70]
  icon: text-[#129b70]

Logout Button:
  text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200
  text-xs font-semibold px-3 py-2 rounded-lg w-full flex items-center gap-2.5

Footer:
  text-[10px] text-[#8b9e95] uppercase tracking-tight text-center
  "iSysware" text: text-[#129b70] font-semibold
```

---

### 4.11 Header (Top Bar)

```
Height:   h-14
BG:       bg-white
Border:   border-b border-[#e2eae5]
Position: sticky top-0 z-30
Padding:  px-4 sm:px-6

Portal Badge:
  h-7 px-2.5 rounded-md bg-[#e7f6f1] border border-[#c2e7db]
  text-[#0e7d5a] text-xs font-semibold
  Live dot: h-2 w-2 rounded-full bg-[#10b981]

Breadcrumb:
  Group: text-xs font-medium text-[#73887f]
  Separator: text-[#d2ded8] mx-1.5
  Module: text-xs text-[#111827] font-bold

Global Search:
  h-8 bg-[#f6f8f7] hover:bg-white border border-[#e2eae5] hover:border-[#129b70]
  rounded-lg text-xs w-40 lg:w-52 shadow-2xs
  Kbd shortcut: text-[10px] font-mono bg-white border border-[#e2eae5] rounded

Date/Time Chip:
  h-8 px-2.5 rounded-lg bg-[#f6faf8] border border-[#e2eae5]
  text-[#52665e] text-xs font-medium
  Calendar icon: text-[#08775A]

Notification Bell:
  h-8 w-8 rounded-lg border border-[#e2eae5] text-[#52665e]
  hover: text-[#111827] bg-[#f0faf6] border-[#129b70]/40
  Unread dot: h-2 w-2 bg-rose-600 ring-2 ring-white

User Avatar:
  h-8 w-8 rounded-full bg-[#dff5ea] text-[#0e7d5a] font-bold text-sm
```

---

### 4.12 State Views

#### Loading Spinner
```tsx
<div className="flex flex-col items-center justify-center py-28 text-slate-500 gap-3">
  <Loader2 className="h-7 w-7 animate-spin text-[#08775A]" />
  <span className="text-sm font-semibold text-slate-600">Loading records...</span>
</div>
```

#### Skeleton Table
```tsx
<div className="w-full animate-pulse space-y-3 p-4">
  <div className="h-9 bg-slate-100 rounded-lg w-full" />
  {[...Array(5)].map((_, i) => (
    <div key={i} className="h-12 bg-slate-50 rounded-lg w-full flex items-center px-4 gap-4">
      <div className="h-4 bg-slate-200 rounded w-1/4" />
      <div className="h-4 bg-slate-200 rounded w-1/3" />
      <div className="h-4 bg-slate-200 rounded w-1/6 ml-auto" />
    </div>
  ))}
</div>
```

#### Empty State
```tsx
<div className="flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 my-4">
  <div className="p-3 rounded-full bg-slate-100 text-slate-400 mb-3">
    <FolderSearch className="h-6 w-6" />
  </div>
  <h4 className="text-sm font-semibold text-slate-800 mb-1">No records found</h4>
  <p className="text-xs text-slate-500 max-w-sm mb-4 leading-relaxed">Description here.</p>
  <button className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#149E75] text-white hover:bg-[#08775A] transition-colors shadow-xs">
    Action
  </button>
</div>
```

#### Error State
```tsx
<div className="flex flex-col items-center justify-center p-8 text-center rounded-xl border border-rose-200 bg-rose-50/50 my-4">
  <div className="p-3 rounded-full bg-rose-100 text-rose-600 mb-3">
    <AlertCircle className="h-6 w-6" />
  </div>
  <h4 className="text-sm font-semibold text-rose-900 mb-1">Unable to load data</h4>
  <p className="text-xs text-rose-700 max-w-sm mb-4 leading-relaxed">{errorMessage}</p>
  <button onClick={onRetry} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors shadow-xs">
    Retry
  </button>
</div>
```

---

## 5. Toast / Notification System

Using react-toastify with HMS Professional Theme (defined in index.css):

| Type | Background |
|---|---|
| Success | #16a34a |
| Error | #dc2626 |
| Warning | #ea580c |
| Info | #2563eb |

All toasts: white icon circle, white text, border-radius 10px, padding 10px 14px, min-height 48px.
Progress bar: 3.5px, rgba(255,255,255,0.42).
Container: width min(390px, 92vw), top-right, top 20px right 20px.

---

## 6. Animations and Transitions

```
Page entry:    animate-in fade-in duration-150
Modal entry:   animate-in fade-in zoom-in-95 duration-150
Interactive:   transition-colors  (color, bg, border changes)
Card hover:    transition-all     (includes shadow-md on hover)
Spinner:       animate-spin
Critical dot:  animate-pulse      (Admitted, critical status dots)
Sidebar slide: transition-all duration-200 ease-in-out
```

---

## 7. Scrollbar (Global in index.css)

```
::-webkit-scrollbar       { width: 7px; height: 7px; }
::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 9999px; }
::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 9999px; border: 1px solid #f1f5f9; }
::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
*                         { scrollbar-width: thin; scrollbar-color: #cbd5e1 #f1f5f9; }
```

---

## 8. Icon Library (Lucide React only)

| Context | Size |
|---|---|
| Sidebar nav item | h-4 w-4 |
| Header / Toolbar | h-4 w-4 or h-3.5 w-3.5 |
| Table row action button | h-3 w-3 |
| KPI card | h-5 w-5 |
| Modal / section heading | h-5 w-5 or h-6 w-6 |
| Empty / error state | h-6 w-6 |
| Loading spinner | h-7 w-7 |

---

## 9. Portal Rules

### All Portals (SuperAdmin, Admission, Inventory, Admin) MUST:

1. Use the **same Sidebar component** (Sidebar.tsx) with correct activePortal prop
2. Use the **same Header component** (Header.tsx) with correct activePortal prop
3. Set **portal-montserrat** class on `<html>` (handled by App.tsx)
4. Use **HospitalKpiHeader** for all stat card grids — never custom KPI cards
5. Use **Table Pattern from 4.5** — dark #0e5944 header strip, sticky thead, paginated rows
6. Use **Filter Toolbar from 4.4** — white card, teal borders on inputs, green focus rings
7. Use **Segmented Tabs from 4.3** — active tab is bg-[#08775A] text-white
8. Use **StatusBadge** component or inline badge pattern from 4.6 — no ad-hoc color strings
9. Use **Modal and ConfirmModal** from components/common/ — never custom modal HTML
10. Use **State Views from 4.12** — consistent loading, skeleton, empty, error everywhere
11. All PKR amounts: **font-mono font-bold tabular-nums** — no exceptions
12. All pages: **space-y-4** — consistent 16px vertical gap between all sections
13. Export buttons: Excel (#16a34a) | CSV (#0284c7) | PDF (#dc2626) | Print (slate-800)

### FrontDesk Portal MUST:

1. Set **portal-inter** class on `<html>`
2. Apply letter-spacing: -0.011em on all elements
3. .font-mono uses tabular-nums variant of Inter

---

## 10. Quick Reference Cheatsheet

```
COLOR TOKENS
Primary green:        #129b70
Primary hover:        #0e7d5a
Primary dark (strip): #0e5944 / #08775A
Primary soft bg:      #effaf5
Primary soft border:  #c2e7db
Page bg:              #f6f8f7
Card bg:              #ffffff
Global border:        #e2eae5
Input border:         #c2e7db
Input focus:          focus:ring-[#08775A] focus:border-[#08775A]
Text primary:         #111827
Text secondary:       #52665e
Text muted:           #8b9e95
Sidebar active bg:    #dff5ea
Sidebar active text:  #0e7d5a

COMPONENT CLASS SHORTCUTS
Card:
  bg-white rounded-2xl border border-[#e2eae5] shadow-[0_2px_8px_rgba(0,0,0,0.03)]

Panel/Toolbar:
  bg-white rounded-xl border border-[#e2eae5] shadow-2xs

Table wrapper:
  bg-white rounded-2xl border border-slate-300/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden

Table header strip:
  bg-[#0e5944] text-white px-4 py-2.5

Table thead:
  bg-[#f8fafc] sticky top-0 z-10 border-b border-slate-200 uppercase tracking-wider select-none text-xs font-bold text-slate-700

Table tbody:
  divide-y divide-slate-100 text-slate-700

Table row hover:
  hover:bg-slate-50/80 transition-colors cursor-pointer group

Pagination bar:
  px-4 py-3 bg-slate-50/80 border-t border-slate-200

Btn primary:    bg-[#129b70] hover:bg-[#0e7d5a] text-white text-xs font-bold rounded-lg shadow-xs px-3.5 py-2
Btn secondary:  bg-white hover:bg-[#f6faf8] text-[#52665e] border border-[#e2eae5] text-xs font-semibold rounded-lg shadow-2xs px-3 py-2
Btn danger:     bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg shadow-xs px-4 py-2
Input:          border border-[#c2e7db] rounded-lg text-xs px-3 py-2 bg-white focus:ring-2 focus:ring-[#08775A]/20 focus:border-[#08775A] placeholder:text-[#8b9e95]
```

---

> **Last Updated:** October 2026
> **Source of Truth:** FrontDesk Portal - src/features/frontDesk/, src/components/, src/index.css
> **Apply To:** SuperAdmin, Admission, Inventory, Admin portal views
