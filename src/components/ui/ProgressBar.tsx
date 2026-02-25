interface Props {
  percentage: number;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

export function ProgressBar({ percentage, showLabel = true, size = 'md' }: Props) {
  const height = size === 'sm' ? 'h-1.5' : 'h-2.5';

  const color =
    percentage === 100
      ? 'bg-green-500'
      : percentage >= 60
      ? 'bg-primary-500'
      : percentage >= 30
      ? 'bg-yellow-500'
      : 'bg-gray-300';

  return (
    <div className="flex items-center gap-3">
      <div className={`flex-1 bg-gray-200 rounded-full ${height} overflow-hidden`}>
        <div
          className={`${height} rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-medium text-gray-600 w-10 text-right">
          {percentage}%
        </span>
      )}
    </div>
  );
}
