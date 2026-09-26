import React, { useState, useRef, useEffect } from 'react';
import { cn, formatCnicInput } from '../../utils/formatters';
export { formatCnicInput };
import { Calendar, ChevronDown, Check, UploadCloud, X, Search, FileText, Clock } from 'lucide-react';

export interface BaseInputProps {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  id?: string;
  disabled?: boolean;
}

// 1. Text Input
export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement>, BaseInputProps {
  icon?: React.ReactNode;
  rightElement?: React.ReactNode;
}

// Helper utilities for strictly Day/Month/Year input format
function toDDMMYYYY(val?: string | number | readonly string[]): string {
  if (!val || typeof val !== 'string') return '';
  const match = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  return val;
}

function toISO(val: string): string {
  const match = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    const [, d, m, y] = match;
    const day = parseInt(d, 10);
    const month = parseInt(m, 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${y}-${m}-${d}`;
    }
  }
  return '';
}

function formatTypedDate(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export const DateInputControl: React.FC<TextInputProps> = ({
  label,
  error,
  hint,
  required,
  className,
  id,
  value,
  onChange,
  disabled,
  min,
  max,
  type: _type, // strip out — we always render type="text" for the visible input
  ...props
}) => {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  const hiddenPickerRef = useRef<HTMLInputElement>(null);

  // Maintain display string strictly in DD/MM/YYYY format
  const [displayValue, setDisplayValue] = useState(() => toDDMMYYYY(value));

  useEffect(() => {
    setDisplayValue(toDDMMYYYY(value));
  }, [value]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatTypedDate(e.target.value);
    setDisplayValue(formatted);

    const iso = toISO(formatted);
    if (iso) {
      if (onChange) {
        const syntheticEvent = {
          ...e,
          target: { ...e.target, value: iso, name: props.name || '' },
          currentTarget: { ...e.currentTarget, value: iso, name: props.name || '' },
        };
        onChange(syntheticEvent as any);
      }
    } else if (formatted === '') {
      if (onChange) {
        const syntheticEvent = {
          ...e,
          target: { ...e.target, value: '', name: props.name || '' },
          currentTarget: { ...e.currentTarget, value: '', name: props.name || '' },
        };
        onChange(syntheticEvent as any);
      }
    }
  };

  const handlePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isoVal = e.target.value;
    setDisplayValue(toDDMMYYYY(isoVal));
    if (onChange) {
      onChange(e);
    }
  };

  const openPicker = () => {
    if (disabled) return;
    try {
      hiddenPickerRef.current?.showPicker();
    } catch {
      hiddenPickerRef.current?.focus();
      hiddenPickerRef.current?.click();
    }
  };

  const isoMin = typeof min === 'string' ? min : undefined;
  const isoMax = typeof max === 'string' ? max : undefined;
  const currentIsoValue = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value : toISO(displayValue);

  return (
    <div className={cn('w-full flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-slate-700">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <div className="relative flex items-center">
        <input
          id={inputId}
          disabled={disabled}
          type="text"
          inputMode="numeric"
          placeholder="DD/MM/YYYY"
          maxLength={10}
          value={displayValue}
          onChange={handleTextChange}
          className={cn(
            'w-full rounded-lg border bg-white px-3 py-2 pr-10 text-xs text-slate-900 placeholder:text-slate-400 font-medium transition-colors',
            'focus:outline-hidden focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]',
            disabled && 'bg-slate-50 text-slate-400 cursor-not-allowed border-slate-200',
            error ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20' : 'border-slate-300'
          )}
          {...props}
        />

        {/* Hidden native date picker with button trigger */}
        <div className="absolute right-1.5 flex items-center">
          <input
            ref={hiddenPickerRef}
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            value={currentIsoValue}
            min={isoMin}
            max={isoMax}
            onChange={handlePickerChange}
            className="absolute inset-0 w-full h-full opacity-0 pointer-events-none -z-10"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={openPicker}
            disabled={disabled}
            className="p-1 rounded-md text-slate-400 hover:text-[#08775A] hover:bg-slate-100 transition-colors cursor-pointer"
            title="Open calendar (DD/MM/YYYY)"
          >
            <Calendar className="h-4 w-4" />
          </button>
        </div>
      </div>
      {error && <span className="text-[11px] text-rose-600 font-medium">{error}</span>}
      {!error && hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
};

export const DateInput = DateInputControl;

export const TextInput: React.FC<TextInputProps> = (props) => {
  if (props.type === 'date') {
    return <DateInputControl {...props} />;
  }

  const {
    label,
    error,
    hint,
    required,
    className,
    id,
    icon,
    rightElement,
    disabled,
    onWheel,
    ...restProps
  } = props;
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  // Chrome/Edge silently change a focused <input type="number">'s value by
  // ±1 per mouse-wheel tick while the page scrolls underneath it — an easy,
  // invisible way for a money field to drift off the figure someone typed.
  // Blur on wheel so scrolling the page never edits the value.
  const handleWheel =
    props.type === 'number'
      ? (e: React.WheelEvent<HTMLInputElement>) => {
          onWheel?.(e);
          e.currentTarget.blur();
        }
      : onWheel;
  return (
    <div className={cn('w-full flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold text-slate-700">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <div className="relative flex items-center">
        {icon && (
          <div className="absolute left-3 text-slate-400 pointer-events-none flex items-center">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          disabled={disabled}
          onWheel={handleWheel}
          className={cn(
            'w-full rounded-lg border bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 transition-colors',
            'focus:outline-hidden focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]',
            disabled && 'bg-slate-50 text-slate-400 cursor-not-allowed border-slate-200',
            error ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20' : 'border-slate-300',
            icon && 'pl-9',
            rightElement && 'pr-9'
          )}
          {...restProps}
        />
        {rightElement && (
          <div className="absolute right-3 flex items-center text-slate-400">
            {rightElement}
          </div>
        )}
      </div>
      {error && <span className="text-[11px] text-rose-600 font-medium">{error}</span>}
      {!error && hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
};

// 2. Number Input
export interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>, BaseInputProps {
  min?: number;
  max?: number;
  // 'any' is a real, standard HTML `step` value (removes the decimal-step
  // restriction) — several money inputs rely on it.
  step?: number | 'any';
}

export const NumberInput: React.FC<NumberInputProps> = ({
  label,
  error,
  hint,
  required,
  className,
  id,
  ...props
}) => {
  return (
    <TextInput
      type="number"
      label={label}
      error={error}
      hint={hint}
      required={required}
      className={className}
      id={id}
      {...props}
    />
  );
};

// 3. Currency Input (PKR)
export interface CurrencyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>, BaseInputProps {
  currencyCode?: string;
}

export const CurrencyInput: React.FC<CurrencyInputProps> = ({
  label,
  error,
  hint,
  required,
  className,
  id,
  currencyCode = 'PKR',
  ...props
}) => {
  return (
    <TextInput
      type="number"
      label={label}
      error={error}
      hint={hint}
      required={required}
      className={className}
      id={id}
      icon={<span className="text-xs font-bold text-slate-600">{currencyCode}</span>}
      placeholder="0"
      {...props}
    />
  );
};

// 4. Phone Input (+92 format)
export interface PhoneInputProps extends React.InputHTMLAttributes<HTMLInputElement>, BaseInputProps {}

export const PhoneInput: React.FC<PhoneInputProps> = ({
  label,
  error,
  hint,
  required,
  className,
  id,
  ...props
}) => {
  return (
    <TextInput
      type="tel"
      label={label}
      error={error}
      hint={hint || 'Format: 0300 1234567'}
      required={required}
      className={className}
      id={id}
      icon={<span className="text-xs font-bold text-slate-500">+92</span>}
      placeholder="300 1234567"
      {...props}
    />
  );
};

// 4b. CNIC Input (Auto XXXXX-XXXXXXX-X formatting)
export interface CNICInputProps extends Omit<TextInputProps, 'onChange'> {
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onValueChange?: (formattedValue: string) => void;
}

export const CNICInput: React.FC<CNICInputProps> = ({
  value,
  onChange,
  onValueChange,
  label = 'CNIC',
  placeholder = 'XXXXX-XXXXXXX-X',
  hint,
  maxLength = 15,
  ...props
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCnicInput(e.target.value);
    e.target.value = formatted;
    if (onChange) {
      onChange(e);
    }
    if (onValueChange) {
      onValueChange(formatted);
    }
  };

  return (
    <TextInput
      label={label}
      placeholder={placeholder}
      hint={hint}
      value={value}
      onChange={handleChange}
      maxLength={maxLength}
      {...props}
    />
  );
};

// 5. Date Picker
export interface DatePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>, BaseInputProps {}

export const DatePicker: React.FC<DatePickerProps> = ({
  label,
  error,
  hint,
  required,
  className,
  id,
  ...props
}) => {
  return (
    <TextInput
      lang="en-GB" type="date"
      label={label}
      error={error}
      hint={hint}
      required={required}
      className={className}
      id={id}
      icon={<Calendar className="h-4 w-4" />}
      {...props}
    />
  );
};

// 5b. Time Picker Input (Calendar/Clock style selection)
export interface TimePickerInputProps extends BaseInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  presets?: string[];
  use12Hour?: boolean;
}

export function parseTimeTo24(timeStr?: string): string {
  if (!timeStr || !timeStr.trim()) return '';
  const trimmed = timeStr.trim();
  const match24 = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (match24) {
    return `${match24[1]!.padStart(2, '0')}:${match24[2]!}`;
  }
  const match12 = trimmed.match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i);
  if (match12) {
    let hours = parseInt(match12[1]!, 10);
    const minutes = match12[2]!;
    const period = match12[3]!.toUpperCase();
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }
  return '';
}

export function formatTimeFrom24(time24: string, use12Hour = true): string {
  if (!time24) return '';
  const match = time24.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return time24;
  if (!use12Hour) return time24;
  let hours = parseInt(match[1]!, 10);
  const minutes = match[2]!;
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, '0')}:${minutes} ${period}`;
}

export const TimePickerInput: React.FC<TimePickerInputProps> = ({
  label,
  value,
  onChange,
  placeholder = 'Select time…',
  presets,
  use12Hour = true,
  error,
  hint,
  required,
  className,
  id,
  disabled,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const val24 = parseTimeTo24(value);
  const displayVal = value ? (use12Hour ? formatTimeFrom24(val24, true) || value : val24) : '';

  const handleNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw24 = e.target.value;
    if (!raw24) {
      onChange('');
      return;
    }
    const formatted = use12Hour ? formatTimeFrom24(raw24, true) : raw24;
    onChange(formatted);
  };

  const openPicker = () => {
    if (disabled) return;
    if (inputRef.current) {
      if ('showPicker' in HTMLInputElement.prototype) {
        try {
          inputRef.current.showPicker();
        } catch {
          inputRef.current.focus();
        }
      } else {
        inputRef.current.focus();
      }
    }
  };

  return (
    <div className={cn('w-full flex flex-col gap-1', className)}>
      {label && (
        <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
          <span>
            {label} {required && <span className="text-rose-500">*</span>}
          </span>
          {displayVal && (
            <span className="text-[10px] font-mono text-[#08775A] font-semibold bg-[#08775A]/10 px-1.5 py-0.2 rounded">
              {displayVal}
            </span>
          )}
        </label>
      )}
      <div
        onClick={openPicker}
        className={cn(
          'relative flex items-center rounded-lg border bg-white px-3 py-2 text-xs transition-colors cursor-pointer group',
          'focus-within:ring-2 focus-within:ring-[#129b70]/20 focus-within:border-[#129b70]',
          error ? 'border-rose-400' : 'border-slate-300 hover:border-slate-400',
          disabled && 'bg-slate-50 opacity-60 cursor-not-allowed'
        )}
      >
        <Clock className="h-4 w-4 text-slate-400 group-hover:text-[#08775A] mr-2 shrink-0 transition-colors" />
        <span className={cn('flex-1 font-mono text-xs', displayVal ? 'text-slate-900 font-bold' : 'text-slate-400')}>
          {displayVal || placeholder}
        </span>
        <input
          ref={inputRef}
          type="time"
          value={val24}
          onChange={handleNativeChange}
          disabled={disabled}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          tabIndex={-1}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openPicker();
          }}
          className="text-[11px] font-semibold text-[#08775A] hover:underline px-1.5 py-0.5 rounded hover:bg-emerald-50 transition-colors cursor-pointer"
        >
          Pick
        </button>
      </div>

      {presets && presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[10px] text-slate-400 font-medium">Quick:</span>
          {presets.map((p) => {
            const isSelected = value === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onChange(p)}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] font-mono font-medium border transition-colors cursor-pointer',
                  isSelected
                    ? 'bg-[#08775A] text-white border-[#08775A]'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200'
                )}
              >
                {p}
              </button>
            );
          })}
        </div>
      )}

      {error && <span className="text-[11px] text-rose-600 font-medium">{error}</span>}
      {!error && hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
};

// 6. Date Range
export interface DateRangeProps extends BaseInputProps {
  startDate: string;
  endDate: string;
  onChangeStartDate: (date: string) => void;
  onChangeEndDate: (date: string) => void;
}

export const DateRange: React.FC<DateRangeProps> = ({
  label,
  startDate,
  endDate,
  onChangeStartDate,
  onChangeEndDate,
  error,
  hint,
  required,
  className,
}) => {
  return (
    <div className={cn('w-full flex flex-col gap-1', className)}>
      {label && (
        <label className="text-xs font-semibold text-slate-700">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            lang="en-GB" type="date"
            value={startDate}
            onChange={(e) => onChangeStartDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
          />
        </div>
        <span className="text-xs text-slate-400 font-medium">to</span>
        <div className="relative flex-1">
          <input
            lang="en-GB" type="date"
            value={endDate}
            onChange={(e) => onChangeEndDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]"
          />
        </div>
      </div>
      {error && <span className="text-[11px] text-rose-600 font-medium">{error}</span>}
      {!error && hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
};

// 7. Select
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement>, BaseInputProps {
  options: SelectOption[];
  placeholder?: string;
}

export const Select: React.FC<SelectProps> = ({
  label,
  options,
  error,
  hint,
  required,
  className,
  id,
  placeholder = 'Select option...',
  disabled,
  ...props
}) => {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  const hasEmptyOption = options.some((opt) => opt.value === '');
  return (
    <div className={cn('w-full flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={selectId} className="text-xs font-semibold text-slate-700">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          disabled={disabled}
          className={cn(
            'w-full appearance-none rounded-lg border bg-white px-3 py-2 pr-8 text-xs text-slate-900 transition-colors',
            'focus:outline-hidden focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]',
            disabled && 'bg-slate-50 text-slate-400 cursor-not-allowed border-slate-200',
            error ? 'border-rose-400 focus:border-rose-500' : 'border-slate-300'
          )}
          {...props}
        >
          {placeholder && !hasEmptyOption && <option value="">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 pointer-events-none text-slate-400" />
      </div>
      {error && <span className="text-[11px] text-rose-600 font-medium">{error}</span>}
      {!error && hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
};

// 8. Multi Select
export interface MultiSelectProps extends BaseInputProps {
  options: SelectOption[];
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  options,
  value = [],
  onChange,
  error,
  hint,
  required,
  className,
  placeholder = 'Select multiple...',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const toggleOption = (val: string) => {
    if (value.includes(val)) {
      onChange(value.filter((v) => v !== val));
    } else {
      onChange([...value, val]);
    }
  };

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className={cn('w-full flex flex-col gap-1 relative', className)}>
      {label && (
        <label className="text-xs font-semibold text-slate-700">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full min-h-[34px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs flex flex-wrap items-center gap-1.5 cursor-pointer hover:border-slate-400 transition-colors"
      >
        {value.length === 0 && <span className="text-slate-400">{placeholder}</span>}
        {value.map((val) => {
          const opt = options.find((o) => o.value === val);
          return (
            <span
              key={val}
              className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px] font-medium border border-slate-200"
            >
              {opt?.label || val}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleOption(val);
                }}
                className="hover:text-rose-600"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <ChevronDown className="ml-auto h-4 w-4 text-slate-400" />
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-white rounded-lg border border-slate-200 shadow-xl overflow-hidden flex flex-col">
            {options.length > 5 && (
              <div className="p-1.5 border-b border-slate-100 bg-slate-50 flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5 text-slate-400 shrink-0 ml-1" />
                <input
                  type="text"
                  placeholder="Search services..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full text-xs bg-transparent border-0 focus:outline-none placeholder:text-slate-400 text-slate-700"
                  autoFocus
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearchTerm('');
                    }}
                    className="p-0.5 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
            <div className="max-h-52 overflow-y-auto py-1">
              {filteredOptions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-400 text-center">No matching services found</div>
              ) : (
                filteredOptions.map((opt) => {
                  const isSelected = value.includes(opt.value);
                  return (
                    <div
                      key={opt.value}
                      onClick={() => toggleOption(opt.value)}
                      className={cn(
                        'px-3 py-1.5 text-xs flex items-center justify-between hover:bg-slate-50 cursor-pointer text-slate-700 transition-colors',
                        isSelected && 'bg-emerald-50/50 text-[#08775A] font-medium'
                      )}
                    >
                      <span>{opt.label}</span>
                      {isSelected && <Check className="h-4 w-4 text-[#129b70]" />}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
      {error && <span className="text-[11px] text-rose-600 font-medium">{error}</span>}
      {!error && hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
};

// 9. Searchable Select
export interface SearchableSelectProps extends BaseInputProps {
  options: SelectOption[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  label,
  options,
  value,
  onChange,
  error,
  hint,
  required,
  className,
  placeholder = 'Search & select...',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedOpt = options.find((o) => o.value === value);
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className={cn('w-full flex flex-col gap-1 relative', className)}>
      {label && (
        <label className="text-xs font-semibold text-slate-700">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs flex items-center justify-between cursor-pointer hover:border-slate-400 transition-colors"
      >
        <span className={selectedOpt ? 'text-slate-900 font-medium' : 'text-slate-400'}>
          {selectedOpt ? selectedOpt.label : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-white rounded-lg border border-slate-200 shadow-xl py-1 max-h-56 flex flex-col">
            <div className="p-2 border-b border-slate-100 flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                className="w-full text-xs outline-hidden text-slate-800"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1 py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-400 text-center">No results found</div>
              ) : (
                filtered.map((opt) => (
                  <div
                    key={opt.value}
                    onClick={() => {
                      onChange(opt.value);
                      setIsOpen(false);
                      setQuery('');
                    }}
                    className={cn(
                      'px-3 py-1.5 text-xs flex items-center justify-between hover:bg-slate-50 cursor-pointer',
                      opt.value === value ? 'bg-[#effaf5] text-[#0e7d5a] font-semibold' : 'text-slate-700'
                    )}
                  >
                    <span>{opt.label}</span>
                    {opt.value === value && <Check className="h-3.5 w-3.5 text-[#129b70]" />}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
      {error && <span className="text-[11px] text-rose-600 font-medium">{error}</span>}
      {!error && hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
};

// 10. Textarea
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement>, BaseInputProps {}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  hint,
  required,
  className,
  id,
  rows = 3,
  ...props
}) => {
  const areaId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  return (
    <div className={cn('w-full flex flex-col gap-1', className)}>
      {label && (
        <label htmlFor={areaId} className="text-xs font-semibold text-slate-700">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <textarea
        id={areaId}
        rows={rows}
        className={cn(
          'w-full rounded-lg border bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 transition-colors',
          'focus:outline-hidden focus:ring-2 focus:ring-[#129b70]/20 focus:border-[#129b70]',
          error ? 'border-rose-400' : 'border-slate-300'
        )}
        {...props}
      />
      {error && <span className="text-[11px] text-rose-600 font-medium">{error}</span>}
      {!error && hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
};

// 11. Checkbox
export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: React.ReactNode;
  hint?: string;
  error?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  label,
  hint,
  error,
  className,
  id,
  ...props
}) => {
  const boxId = id || `chk_${Math.random().toString(36).substring(2, 7)}`;
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        type="checkbox"
        id={boxId}
        className="h-4 w-4 rounded border-slate-300 text-[#129b70] focus:ring-[#129b70]/20 mt-0.5 cursor-pointer"
        {...props}
      />
      <div className="flex flex-col">
        <label htmlFor={boxId} className="text-xs font-medium text-slate-800 cursor-pointer select-none">
          {label}
        </label>
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
        {error && <span className="text-[11px] text-rose-600 font-medium">{error}</span>}
      </div>
    </div>
  );
};

// 12. Radio Group
export interface RadioOption {
  value: string;
  label: string;
  description?: string;
}

export interface RadioGroupProps {
  name: string;
  label?: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  inline?: boolean;
  className?: string;
}

export const RadioGroup: React.FC<RadioGroupProps> = ({
  name,
  label,
  options,
  value,
  onChange,
  inline = false,
  className,
}) => {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && <span className="text-xs font-semibold text-slate-700">{label}</span>}
      <div className={cn('flex gap-3', inline ? 'flex-row flex-wrap items-center' : 'flex-col')}>
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex items-start gap-2.5 cursor-pointer select-none p-1.5 rounded-md hover:bg-slate-50 transition-colors"
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="h-4 w-4 border-slate-300 text-[#129b70] focus:ring-[#129b70] mt-0.5"
            />
            <div className="flex flex-col">
              <span className="text-xs font-medium text-slate-800">{opt.label}</span>
              {opt.description && <span className="text-[11px] text-slate-500">{opt.description}</span>}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
};

// 13. Toggle Switch
export interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
  className?: string;
}

export const Toggle: React.FC<ToggleProps> = ({
  label,
  checked,
  onChange,
  disabled,
  hint,
  className,
}) => {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      {label && (
        <div className="flex flex-col">
          <span className="text-xs font-medium text-slate-800">{label}</span>
          {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden',
          checked ? 'bg-[#129b70]' : 'bg-slate-300',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out',
            checked ? 'translate-x-4' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  );
};

// 14. File Upload (drag and drop + click)
export interface FileUploadProps extends BaseInputProps {
  accept?: string;
  onFileSelect?: (file: File) => void;
  maxSizeMB?: number;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  label,
  error,
  hint = 'Excel, CSV, PDF, or image files up to 10MB',
  required,
  accept,
  onFileSelect,
  className,
}) => {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      onFileSelect?.(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      onFileSelect?.(file);
    }
  };

  return (
    <div className={cn('w-full flex flex-col gap-1', className)}>
      {label && (
        <label className="text-xs font-semibold text-slate-700">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex flex-col items-center justify-center p-5 rounded-xl border-2 border-dashed transition-colors cursor-pointer text-center bg-slate-50/50',
          dragOver ? 'border-[#129b70] bg-[#effaf5]' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50',
          error && 'border-rose-400'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleFileChange}
          className="hidden"
        />
        {selectedFile ? (
          <div className="flex items-center gap-2 text-slate-800">
            <FileText className="h-5 w-5 text-[#129b70]" />
            <div className="text-left">
              <p className="text-xs font-semibold">{selectedFile.name}</p>
              <p className="text-[10px] text-slate-500">
                {(selectedFile.size / 1024).toFixed(1)} KB • Ready to upload
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedFile(null);
              }}
              className="ml-2 text-slate-400 hover:text-rose-600 p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <UploadCloud className="h-8 w-8 text-slate-400 mb-2" />
            <p className="text-xs font-medium text-slate-700">
              <span className="text-[#129b70] font-semibold underline">Click to upload</span> or drag and drop
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>
          </>
        )}
      </div>
      {error && <span className="text-[11px] text-rose-600 font-medium">{error}</span>}
    </div>
  );
};

export { ServiceChecklist } from './ServiceChecklist';
