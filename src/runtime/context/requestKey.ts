/** Include every input, preserving array order and full query text. Invalid paths never coalesce. */
export function contextRequestKey(args: Record<string, unknown>, projectPath: string): string {
  const stable = (value: any): any => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map(key => [key, stable(value[key])])
      );
    }
    return value;
  };
  return JSON.stringify(stable({ ...args, projectPath }));
}
