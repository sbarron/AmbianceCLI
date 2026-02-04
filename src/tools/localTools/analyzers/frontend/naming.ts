export function nameFor(
  http: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS',
  urlPath: string
): string {
  const verbMap: Record<string, string> = {
    GET: 'get',
    POST: 'create',
    PUT: 'update',
    PATCH: 'update',
    DELETE: 'remove',
    HEAD: 'get',
    OPTIONS: 'get',
  };
  const verb = verbMap[http] || 'get';

  // Return generic name for invalid paths
  if (!urlPath || urlPath === '/' || urlPath.length < 2) {
    return verb + 'Request';
  }

  // Skip malformed paths that might cause issues
  if (urlPath === '/https' || urlPath === '/http' || urlPath.startsWith('/http')) {
    return verb + 'Request';
  }

  // Drop /api prefix from name and drop version segment from name
  let noApi = urlPath.replace(/^\/api\/?/, '');
  noApi = noApi.replace(/^v\d+\//, '');

  // Handle special cases for common API patterns
  if (noApi.startsWith('repos/github')) {
    noApi = noApi.replace('repos/github', 'githubRepos');
  }

  // Split into segments and filter out empty ones
  const rawSegs = noApi.split('/').filter(Boolean);

  // If no meaningful segments, return generic name
  if (rawSegs.length === 0) {
    return verb + 'Request';
  }

  // Remove parameter segments and process remaining segments
  const segs = rawSegs.filter(s => !s.startsWith(':'));

  // If all segments were parameters, use a generic name based on the last parameter
  if (segs.length === 0 && rawSegs.length > 0) {
    const lastParam = rawSegs[rawSegs.length - 1].replace(/^:/, '');
    // Only use parameter name if it's a reasonable identifier
    if (
      lastParam.length > 0 &&
      lastParam.length < 20 &&
      /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(lastParam)
    ) {
      return verb + lastParam.charAt(0).toUpperCase() + lastParam.slice(1);
    }
    return verb + 'ById'; // Fallback for parameter-based endpoints
  }

  // Process segments: convert to camelCase, handle special cases
  const processedSegs = segs
    .map(seg => {
      // Handle kebab-case and snake_case
      seg = seg.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
      seg = seg.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());

      // Remove non-alphanumeric characters
      seg = seg.replace(/[^a-zA-Z0-9]/g, '');

      // Skip empty segments after cleaning
      if (!seg || seg.length === 0) return null;

      return seg;
    })
    .filter((seg): seg is string => seg !== null && seg.length > 0) // Remove nulls and empty segments
    .map((seg, i) => {
      if (i === 0) {
        // First segment: lowercase first letter
        return seg.charAt(0).toLowerCase() + seg.slice(1);
      } else {
        // Subsequent segments: uppercase first letter
        return seg.charAt(0).toUpperCase() + seg.slice(1);
      }
    });

  // Build the final name
  const resourceName = processedSegs.join('');

  // Handle edge case where we end up with no resource name
  if (!resourceName || resourceName.length === 0) {
    return verb + 'Request';
  }

  // Ensure the final name is properly capitalized and not too long
  const finalName = verb + resourceName.charAt(0).toUpperCase() + resourceName.slice(1);

  // If the name is too long or contains weird characters, use a generic name
  if (finalName.length > 50 || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(finalName)) {
    return verb + 'Request';
  }

  return finalName;
}

/**
 * Generate unique method names by appending suffixes when duplicates exist
 */
export function generateUniqueMethodName(
  baseName: string,
  existingNames: Set<string>,
  method: string,
  path: string
): string {
  let uniqueName = baseName;
  let counter = 1;

  // If base name already exists, try variations
  while (existingNames.has(uniqueName)) {
    // For generic names like getRequest, try to generate a more descriptive name first
    if (baseName.endsWith('Request') && counter === 1) {
      // Try to extract meaningful parts from the path
      const pathParts = path
        .replace(/^\/api\/?/, '')
        .replace(/^v\d+\//, '')
        .split('/')
        .filter(Boolean);
      if (pathParts.length > 0) {
        const meaningfulPart = pathParts[pathParts.length - 1];
        if (meaningfulPart && meaningfulPart !== ':' + meaningfulPart) {
          uniqueName = baseName.replace(
            'Request',
            meaningfulPart.charAt(0).toUpperCase() + meaningfulPart.slice(1)
          );
          if (!existingNames.has(uniqueName)) {
            break;
          }
        }
      }
    }

    // Try adding method-specific suffix only if it makes sense
    if (counter === 1) {
      const methodSuffix = method.toLowerCase();
      const newName = baseName + methodSuffix.charAt(0).toUpperCase() + methodSuffix.slice(1);

      // Only add method suffix if the base name doesn't already start with the verb
      if (!baseName.toLowerCase().startsWith(methodSuffix)) {
        uniqueName = newName;
      } else {
        // If base name already starts with verb, use a more descriptive suffix
        const pathParts = path
          .replace(/^\/api\/?/, '')
          .replace(/^v\d+\//, '')
          .split('/')
          .filter(Boolean);
        if (pathParts.length > 0) {
          const lastPart = pathParts[pathParts.length - 1];
          if (lastPart && lastPart !== ':' + lastPart && lastPart.length < 20) {
            uniqueName = baseName + lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
          } else {
            uniqueName = baseName + counter;
          }
        } else {
          uniqueName = baseName + counter;
        }
      }
    } else {
      // Fall back to numeric suffix
      uniqueName = baseName + counter;
    }
    counter++;
  }

  return uniqueName;
}
