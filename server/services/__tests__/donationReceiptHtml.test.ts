import { describe, expect, it } from 'vitest';

import {
  convertLegacyMarkdown,
  DEFAULT_HTML_TEMPLATE,
  LEGACY_DEFAULT_HTML_TEMPLATE_V0,
  LEGACY_DEFAULT_HTML_TEMPLATE_V1,
  TEMPLATE_VARIABLES,
  prepareTemplate,
  substituteTemplate,
  TemplateValidationError,
} from '../donationReceiptHtml.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('prepareTemplate sanitization', () => {
  it('keeps supported tags and text-align styles', () => {
    const { html } = prepareTemplate(
      '<h1>Title</h1><p style="text-align:center">Centered</p>' +
      '<strong>bold</strong> <em>italic</em> <del>gone</del> <code>x()</code><br>' +
      '<ul><li>a</li></ul><table><tr><td>c</td></tr></table>' +
      '<blockquote>q</blockquote><hr><a href="https://example.com">link</a>'
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p style="text-align:center">Centered</p>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<code>x()</code>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<table>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<a href="https://example.com">link</a>');
  });

  it('strips scripts, event handlers, embedded content, images, and external CSS', () => {
    const { html } = prepareTemplate(
      '<script>alert(1)</script><style>p{color:red}</style>' +
      '<p onclick="alert(1)">hi <img src="x" onerror="alert(1)"></p>' +
      '<iframe src="https://evil.example"></iframe><link rel="stylesheet" href="https://evil.example/x.css">' +
      '<p>after</p>'
    );
    expect(html).not.toContain('script');
    expect(html).not.toContain('style');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('img');
    expect(html).not.toContain('iframe');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('hi');
    expect(html).toContain('after');
  });

  it('strips unsafe link schemes and non-text-align styles', () => {
    const { html } = prepareTemplate(
      '<a href="javascript:alert(1)">bad</a><a href="data:text/html,x">data</a>' +
      '<a href="#frag">frag</a><a href="https://ok.example">ok</a>' +
      '<p style="color:red">plain</p><p style="text-align:right">right</p>'
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
    expect(html).toContain('<a href="#frag">frag</a>');
    expect(html).toContain('<a href="https://ok.example">ok</a>');
    expect(html).not.toContain('color:red');
    expect(html).toContain('<p style="text-align:right">right</p>');
  });

  it('unwraps unsupported benign tags, keeping their content', () => {
    const { html } = prepareTemplate('<span>keep <b>this</b></span>');
    expect(html).toContain('keep');
    expect(html).not.toContain('<span>');
    expect(html).not.toContain('<b>');
  });

  it('rejects template variables inside attributes on new submissions', () => {
    expect(() => prepareTemplate('<a href="{{donor_id}}">x</a>'))
      .toThrow(TemplateValidationError);
    expect(() => prepareTemplate('<a href="https://x/{{donor_id}}">x</a>'))
      .toThrow(/not allowed inside HTML attributes/);
    expect(() => prepareTemplate('<p style="text-align:{{align}}">x</p>'))
      .toThrow(/not allowed inside HTML attributes/);
  });

  it('rejects unknown variables', () => {
    expect(() => prepareTemplate('<p>{{bogus_variable}}</p>'))
      .toThrow(/Unknown template variables: bogus_variable/);
  });

  it('rejects templates that become empty after sanitization', () => {
    expect(() => prepareTemplate('<script>alert(1)</script>'))
      .toThrow(/empty after sanitization/);
    expect(() => prepareTemplate('   \n  '))
      .toThrow(/empty after sanitization/);
  });

  it('rejects structural shells with no meaningful content', () => {
    const shells = ['<p></p>', '<div></div>', '<table></table>', '<p><br></p>', '<ul><li></li></ul>'];
    for (const shell of shells) {
      expect(() => prepareTemplate(shell)).toThrow(/empty after sanitization/);
    }
    expect(() => prepareTemplate('<p></p><p>real</p>')).not.toThrow();
  });

  it('treats an hr as visible content on its own', () => {
    const { html } = prepareTemplate('<hr>');
    expect(html).toContain('<hr>');
  });

  it('allows empty legacy content when allowEmpty is set', () => {
    const result = prepareTemplate('<script>alert(1)</script>', { legacy: true, allowEmpty: true });
    expect(result.tree).toBeNull();
    expect(result.html).toBe('');
  });
});

describe('convertLegacyMarkdown', () => {
  it('converts headings, bold, horizontal rules, and hard line breaks', () => {
    const html = convertLegacyMarkdown('# Title\n\n**Bold** line  \nsecond line\n\n---\n\nplain');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<br>');
    expect(html).toContain('plain');
  });

  it('converts :::center blocks to centered divs', () => {
    const html = convertLegacyMarkdown(':::center\nCentered {{donor_name}}\n:::');
    expect(html).toContain('<div style="text-align:center">');
    expect(html).toContain('Centered {{donor_name}}');
  });
});

describe('prepareTemplate legacy mode', () => {
  it('unwraps legacy links with attribute placeholders and appends the templated URL as visible text', () => {
    const { html } = prepareTemplate(
      '<p><a href="https://cra.example/{{cra_charitable_registration_number}}">CRA</a></p>',
      { legacy: true }
    );
    expect(html).toContain('CRA');
    expect(html).toContain('(https://cra.example/{{cra_charitable_registration_number}})');
    expect(html).not.toContain('<a href');
  });

  it('keeps legacy links without placeholders intact', () => {
    const { html } = prepareTemplate('<p><a href="https://ok.example">ok</a></p>', { legacy: true });
    expect(html).toContain('<a href="https://ok.example">ok</a>');
  });

  it('detects percent-encoded placeholders in legacy links (marked URL encoding)', () => {
    const { html } = prepareTemplate(
      '<p><a href="https://example.com/%7B%7Bchurch_phone%7D%7D">call</a></p>',
      { legacy: true }
    );
    expect(html).toContain('call');
    expect(html).toContain('(https://example.com/{{church_phone}})');
    expect(html).not.toContain('<a href');
  });

  it('rejects percent-encoded placeholders in links on new submissions', () => {
    expect(() => prepareTemplate('<p><a href="https://x/%7B%7Bdonor_id%7D%7D">x</a></p>'))
      .toThrow(/not allowed inside HTML attributes/);
  });
});

describe('substituteTemplate', () => {
  it('substitutes known variables as escaped text', () => {
    const { tree } = prepareTemplate('<p>Gift from {{donor_name}} ({{donor_id}})</p>');
    const html = substituteTemplate(tree!, {
      donor_name: 'Ana <b>Donor</b> & Co',
      donor_id: '5-001',
    });
    expect(html).toContain('Ana &lt;b&gt;Donor&lt;/b&gt; &amp; Co');
    expect(html).not.toContain('<b>Donor</b>');
    expect(html).toContain('5-001');
  });

  it('converts multiline values such as addresses into br nodes', () => {
    const { tree } = prepareTemplate('<p>{{donor_address}}</p>');
    const html = substituteTemplate(tree!, { donor_address: '456 Receipt Road\nOttawa' });
    expect(html).toBe('<p>456 Receipt Road<br>Ottawa</p>');
  });

  it('keeps substituted values inert when they contain HTML or event handlers', () => {
    const { tree } = prepareTemplate('<p>{{donor_name}}</p>');
    const html = substituteTemplate(tree!, { donor_name: '<img src=x onerror=alert(1)>' });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
  });
});

describe('signer variable substitution and pruning', () => {
  it('substitutes a configured signature with a trusted image node', () => {
    const { tree } = prepareTemplate('<p>{{branch_accountant_signature}}</p>');
    const html = substituteTemplate(tree!, { branch_accountant_signature: PNG });
    expect(html).toContain('<img');
    expect(html).toContain(`src="${PNG}"`);
    expect(html).toContain('width="180"');
    expect(html).toContain('height="70"');
    expect(html).toContain('alt="Branch Accountant signature"');
    expect(html).not.toContain('{{');
  });

  it('uses role-specific alt text for the treasurer signature', () => {
    const { tree } = prepareTemplate('<p>{{treasurer_signature}}</p>');
    const html = substituteTemplate(tree!, { treasurer_signature: PNG });
    expect(html).toContain('alt="Treasurer signature"');
  });

  it('escapes signer names as ordinary text', () => {
    const { tree } = prepareTemplate('<p>{{branch_accountant_name}}</p>');
    const html = substituteTemplate(tree!, { branch_accountant_name: '<b>Ana</b> & Co' });
    expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt; &amp; Co');
    expect(html).not.toContain('<b>Ana</b>');
  });

  it('prunes an empty signer line together with its adjacent break', () => {
    const { tree } = prepareTemplate('<p>Label<br>{{branch_accountant_name}}</p>');
    expect(substituteTemplate(tree!, { branch_accountant_name: '' })).toBe('<p>Label</p>');
  });

  it('prefers the following break when pruning an empty signer line', () => {
    const { tree } = prepareTemplate('<p>{{branch_accountant_name}}<br>Label</p>');
    expect(substituteTemplate(tree!, { branch_accountant_name: '' })).toBe('<p>Label</p>');
  });

  it('consumes one separator per consecutive empty signer variable', () => {
    const { tree } = prepareTemplate(
      '<p>{{branch_accountant_signature}}<br>{{branch_accountant_name}}<br>Authorized representative</p>'
    );
    const html = substituteTemplate(tree!, { branch_accountant_signature: '', branch_accountant_name: '' });
    expect(html).toBe('<p>Authorized representative</p>');
  });

  it('keeps the configured lines when only one signer value is empty', () => {
    const { tree } = prepareTemplate(
      '<p>{{branch_accountant_signature}}<br>{{branch_accountant_name}}</p>'
    );
    // Image present, name empty: the image line keeps its own break.
    expect(substituteTemplate(tree!, { branch_accountant_signature: PNG, branch_accountant_name: '' }))
      .toBe(`<p><img src="${PNG}" width="180" height="70" alt="Branch Accountant signature"></p>`);
    // Image empty, name present: no spacer above the name.
    expect(substituteTemplate(tree!, { branch_accountant_signature: '', branch_accountant_name: 'Ana' }))
      .toBe('<p>Ana</p>');
  });

  it('ignores whitespace-only siblings when locating the adjacent break', () => {
    const { tree } = prepareTemplate('<p>{{branch_accountant_name}} <br>Label</p>');
    const html = substituteTemplate(tree!, { branch_accountant_name: '' });
    expect(html).not.toContain('<br>');
    expect(html).toContain('Label');
  });

  it('removes empty inline wrappers and their containers recursively', () => {
    const { tree } = prepareTemplate('<p><strong>{{branch_accountant_name}}</strong></p>');
    expect(substituteTemplate(tree!, { branch_accountant_name: '' })).toBe('');
  });

  it('keeps the container when the label survives pruning', () => {
    const { tree } = prepareTemplate('<p><strong>Branch Accountant</strong><br>{{branch_accountant_name}}</p>');
    expect(substituteTemplate(tree!, { branch_accountant_name: '' }))
      .toBe('<p><strong>Branch Accountant</strong></p>');
  });

  it('removes only the variable when it is embedded in meaningful text', () => {
    const { tree } = prepareTemplate('<p>Signed by: {{branch_accountant_name}} on file</p>');
    expect(substituteTemplate(tree!, { branch_accountant_name: '' }))
      .toBe('<p>Signed by:  on file</p>');
  });

  it('renders the built-in signer table with both signers configured', () => {
    const { tree } = prepareTemplate(DEFAULT_HTML_TEMPLATE);
    const html = substituteTemplate(tree!, {
      branch_accountant_signature: PNG,
      branch_accountant_name: 'Jane Accountant',
      treasurer_signature: PNG,
      treasurer_name: 'Tom Treasurer',
    });
    expect(html).toContain('<strong>Branch Accountant</strong>');
    expect(html).toContain('<strong>Treasurer</strong>');
    expect(html).toContain('Jane Accountant');
    expect(html).toContain('Tom Treasurer');
    expect(html.match(/<img/g)?.length).toBe(2);
    expect(html).toContain('Authorized Signature');
    expect(html).not.toContain('Authorized representative');
  });

  it('reduces unconfigured built-in signer cells to their labels without spacer lines', () => {
    const { tree } = prepareTemplate(DEFAULT_HTML_TEMPLATE);
    const html = substituteTemplate(tree!, { branch_accountant_signature: '', branch_accountant_name: '' });
    expect(html).not.toContain('<img');
    expect(html).toContain('Branch Accountant</strong></td>');
    expect(html).toContain('Treasurer</strong></td>');
  });

  it('keeps authored img elements stripped even when signer variables are present', () => {
    const result = prepareTemplate('<p><img src="https://evil.example/x.png">{{branch_accountant_signature}}</p>');
    expect(result.html).not.toContain('evil.example');
    expect(result.html).not.toContain('<img');
    expect(result.html).toContain('{{branch_accountant_signature}}');
  });
});

describe('DEFAULT_HTML_TEMPLATE', () => {
  it('is valid, sanitizes cleanly, and substitutes all variables', () => {
    const { tree } = prepareTemplate(DEFAULT_HTML_TEMPLATE);
    const values = {
      church_name: 'Test Church',
      church_address: '1 Main St',
      church_city: 'Ottawa',
      church_province: 'ON',
      church_postal_code: 'K1A 0B1',
      church_phone: '555-0100',
      cra_charitable_registration_number: '12345',
      fiscal_year: '2025',
      receipt_serial_number: '5-001',
      generated_date: '2026-08-05',
      donor_name: 'Ana Donor',
      donor_id: '5-777',
      donor_address: '456 Road',
      donor_city: 'Toronto',
      donor_province: 'ON',
      donor_postal_code: 'M1M 1M1',
      total_amount: '$40.00',
      branch_accountant_signature: PNG,
      branch_accountant_name: 'Jane Accountant',
      treasurer_signature: PNG,
      treasurer_name: 'Tom Treasurer',
    };
    const html = substituteTemplate(tree!, values);
    expect(html).toContain('<h1 style="text-align:center">Official Receipt for Income Tax Purposes</h1>');
    expect(html).toContain('Test Church');
    expect(html).toContain('$40.00');
    expect(html).toContain('Receipt No. 5-001');
    expect(html).toContain('Ana Donor');
    expect(html).toContain('Eligible amount of gift for tax purposes');
    expect(html).toContain('Location receipt issued: Ottawa');
    expect(html).toContain('Date receipt issued: 2026-08-05');
    expect(html).toContain('Jane Accountant');
    expect(html).toContain('Tom Treasurer');
  });
});

describe('template variable catalog', () => {
  it('includes the four signer variables', () => {
    expect(TEMPLATE_VARIABLES).toEqual(expect.arrayContaining([
      'branch_accountant_signature',
      'branch_accountant_name',
      'treasurer_signature',
      'treasurer_name',
    ]));
  });
});

describe('historical default constants', () => {
  it.each([
    ['v0', LEGACY_DEFAULT_HTML_TEMPLATE_V0],
    ['v1', LEGACY_DEFAULT_HTML_TEMPLATE_V1],
  ])('prepares the %s default cleanly with the signer variables accepted', (_label, template) => {
    const { tree } = prepareTemplate(template);
    expect(substituteTemplate(tree!, {})).not.toContain('{{branch_accountant');
  });
});
