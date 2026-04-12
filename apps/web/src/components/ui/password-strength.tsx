interface PasswordStrengthProps {
  password: string;
}

function getStrength(password: string): {
  level: number;
  label: string;
  color: string;
} {
  if (password.length === 0) {
    return { level: 0, label: "", color: "" };
  }

  if (password.length < 8) {
    return { level: 1, label: "Weak", color: "bg-red-500" };
  }

  if (password.length < 12) {
    return { level: 2, label: "Fair", color: "bg-yellow-500" };
  }

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const varietyCount = [hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean).length;

  if (varietyCount >= 3 && password.length >= 14) {
    return { level: 4, label: "Strong", color: "bg-green-500" };
  }

  return { level: 3, label: "Good", color: "bg-green-500" };
}

const SEGMENT_KEYS = ["seg-0", "seg-1", "seg-2", "seg-3"] as const;

export function PasswordStrength({ password }: PasswordStrengthProps): React.ReactElement | null {
  const { level, label, color } = getStrength(password);

  if (level === 0) {
    return null;
  }

  const labelColor =
    level <= 1 ? "text-red-600" : level === 2 ? "text-yellow-600" : "text-green-600";

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {SEGMENT_KEYS.map((key, i) => (
          <div key={key} className={`h-1 flex-1 rounded-full ${i < level ? color : "bg-muted"}`} />
        ))}
      </div>
      <p className={`text-xs ${labelColor}`}>{label}</p>
    </div>
  );
}
