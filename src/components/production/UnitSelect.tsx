import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtQty, type PackUnit } from '@/lib/production';

/** Pick one of an item's units; the value is the unit's name. */
export default function UnitSelect({ units, value, onChange, label, className }: {
  units: PackUnit[];
  value: string;
  onChange: (unit: PackUnit) => void;
  label: string;
  className?: string;
}) {
  const base = units[0]?.name ?? 'unit';
  return (
    <Select value={value} onValueChange={(v) => { const u = units.find((x) => x.name === v); if (u) onChange(u); }}>
      <SelectTrigger aria-label={label} className={className}><SelectValue /></SelectTrigger>
      <SelectContent>
        {units.map((u) => (
          <SelectItem key={u.name} value={u.name}>
            {u.factor === 1 ? u.name : `${u.name} (${fmtQty(u.factor)} ${base})`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
