export function getUpstreamStatus(error) {
  return error?.response?.status || error?.status || error?.statusCode || 500;
}

async function readReadableStreamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

export async function readUpstreamErrorBody(error) {
  if (!error) return '';

  const data = error?.response?.data;

  // axios stream response
  if (data?.readable) {
    try {
      return await readReadableStreamToString(data);
    } catch {
      // fall through
    }
  }

  if (typeof data === 'object' && data !== null) {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }

  if (data !== undefined && data !== null) return String(data);
  if (error.message) {
    if (typeof error.message === 'object') {
      try {
        return JSON.stringify(error.message, null, 2);
      } catch {
        return String(error.message);
      }
    }
    return String(error.message);
  }
  return String(error);
}

export function isCallerDoesNotHavePermission(errorBody) {
  try {
    return JSON.stringify(errorBody).includes('The caller does not');
  } catch {
    return String(errorBody).includes('The caller does not');
  }
}
