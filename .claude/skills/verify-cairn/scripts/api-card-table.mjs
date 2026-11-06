export const REQUESTS_HEADER = ['Clause', 'Request', 'Response', 'Rows before to after', 'ok'];

export const cell = (text) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');

export const requestsRow = ({ clause, method, path, body, status, responseText, rows, ok }) => {
  const shortBody = responseText.length > 120 ? `${responseText.slice(0, 117)}...` : responseText;
  const request = `\`${method} ${path}\`${body === undefined ? '' : ` \`${body}\``}`;
  const response = `\`${status}\` ${shortBody === '' ? '' : `\`${shortBody}\``}`;
  return `| ${[cell(clause), cell(request), cell(response), cell(rows), ok].join(' | ')} |`;
};

export const requestsTable = (rowLines) => [
  `| ${REQUESTS_HEADER.join(' | ')} |`,
  `|${REQUESTS_HEADER.map(() => '---').join('|')}|`,
  ...rowLines,
].join('\n');
