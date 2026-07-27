const { createLogger } = require('../utils/logger');
const { config } = require('../config');
const { sleep } = require('../utils/helpers');
const { getPage, saveCookies } = require('./browser');
const { ensureLoggedIn } = require('./login');

const log = createLogger('SCRAPER');

/**
 * Navigate to ticket list page with optional department filter
 */
async function navigateToTicketPage() {
  const page = getPage();
  if (!page) throw new Error('Browser page not available');

  // Base URL: sorted by created date descending with limit of 25 tickets per page
  let ticketUrl = `${config.oca.url}ticket/list?sortTable=created;-1&page=1&startDate=&endDate=&limit=25`;

  // If there's a department filter, append it
  if (config.oca.departmentFilter) {
    ticketUrl += `&department=${config.oca.departmentFilter}`;
  }

  log.debug(`Navigating to ticket page (${ticketUrl})...`);
  await page.goto(ticketUrl, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  await sleep(3000);

  // Save cookies to maintain session
  await saveCookies();

  return page;
}

/**
 * Scrape ticket data from the OCA Interaction ticket list table
 */
async function scrapeTickets() {
  const page = getPage();
  if (!page) throw new Error('Browser page not available');

  // Ensure we're logged in
  await ensureLoggedIn();

  // Navigate to ticket page
  await navigateToTicketPage();

  // Wait for ticket table to load
  try {
    await page.waitForSelector('table', { timeout: 15000 });
  } catch {
    log.warn('Table not found, checking if page loaded correctly...');
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    log.debug('Page content preview', { text: bodyText });
    return [];
  }

  await sleep(2000);

  // Extract ticket data from the table
  const tickets = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    const ticketData = [];

    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 8) return;

      // Parse each cell
      // Based on the screenshot, columns are:
      // [checkbox] Ticket ID | Customer | Agent | Converse | Priority | Status | Category | Sub Category | Subject | Created
      const cellTexts = Array.from(cells).map((cell) => cell.innerText.trim());

      // Find the status cell — look for "Open" or "Closed"
      let ticketId = '';
      let customer = '';
      let agent = '';
      let status = '';
      let priority = '';
      let category = '';
      let subCategory = '';
      let subject = '';
      let createdDate = '';

      // Ticket ID is usually in format TICKET-XXXXXXX
      for (let i = 0; i < cellTexts.length; i++) {
        const text = cellTexts[i];

        if (text.match(/TICKET-\d+/)) {
          ticketId = text.match(/TICKET-\d+/)[0];
        }

        // Status detection
        if (text === 'Open' || text === 'Closed' || text === 'Pending' || text === 'Resolved') {
          status = text;
        }

        // Priority detection
        if (text === 'Low' || text === 'Medium' || text === 'High' || text === 'Urgent') {
          priority = text;
        }
      }

      // More specific extraction based on column positions
      // Typical order: [0=checkbox], [1=TicketID], [2=Customer], [3=Agent], [4=Converse], [5=Priority], [6=Status], [7=Category], [8=SubCategory], [9=Subject], [10=Created]
      if (cells.length >= 10) {
        ticketId = ticketId || cellTexts[1] || '';
        customer = cellTexts[2] || '';
        agent = cellTexts[3] || '';
        // cellTexts[4] is Conversation type (Inbox, etc.)
        priority = priority || cellTexts[5] || '';
        status = status || cellTexts[6] || '';
        category = cellTexts[7] || '';
        subCategory = cellTexts[8] || '';
        subject = cellTexts[9] || '';
        createdDate = cellTexts[cells.length - 1] || '';
      } else if (cells.length >= 7) {
        // Fallback for fewer columns
        ticketId = ticketId || cellTexts[0] || '';
        customer = cellTexts[1] || '';
        agent = cellTexts[2] || '';
        priority = priority || cellTexts[3] || '';
        status = status || cellTexts[4] || '';
        category = cellTexts[5] || '';
        createdDate = cellTexts[cells.length - 1] || '';
      }

      if (ticketId) {
        ticketData.push({
          ticketId,
          customer,
          agent,
          status,
          priority,
          category,
          subCategory,
          subject,
          createdDate,
        });
      }
    });

    return ticketData;
  });

  log.info(`Scraped ${tickets.length} tickets from current page`);

  // Parse agent field to extract kantor pertanahan
  const enrichedTickets = tickets.map((ticket) => {
    // Agent text often contains kantor pertanahan info
    // Format: "Kantah Kab Gayo Lues - Prov Ac...\n Kantor Pertanahan Kabupaten Ga..."
    const agentLines = ticket.agent.split('\n').map((l) => l.trim()).filter(Boolean);
    let kantorPertanahan = '';

    if (agentLines.length >= 1) {
      // First line is usually the kantor name
      kantorPertanahan = agentLines[0];
    }

    return {
      ...ticket,
      kantorPertanahan,
    };
  });

  return enrichedTickets;
}

/**
 * Scrape tickets across multiple pages (pagination)
 */
async function scrapeAllOpenTickets() {
  const page = getPage();
  if (!page) throw new Error('Browser page not available');

  const allTickets = [];
  let currentPage = 1;
  const maxPages = 5; // Safety limit

  // First scrape
  const firstPageTickets = await scrapeTickets();
  allTickets.push(...firstPageTickets);

  // Check if there are Open tickets that need pagination
  const openTickets = firstPageTickets.filter((t) => t.status === 'Open');

  // If all tickets on first page are enough, don't paginate
  // Only paginate if we need to check more pages for Open tickets
  if (openTickets.length > 0 && firstPageTickets.length >= 10) {
    // Check for pagination — there might be more Open tickets on next pages
    while (currentPage < maxPages) {
      const hasNextPage = await page.evaluate(() => {
        const nextBtn = document.querySelector('.pagination .next:not(.disabled), [aria-label="Next"]:not([disabled])');
        return !!nextBtn;
      });

      if (!hasNextPage) break;

      currentPage++;
      log.debug(`Navigating to page ${currentPage}...`);

      // Click next page
      await page.evaluate(() => {
        const nextBtn = document.querySelector('.pagination .next a, [aria-label="Next"]');
        if (nextBtn) nextBtn.click();
      });

      await sleep(3000);

      // Scrape current page
      const pageTickets = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        const ticketData = [];

        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 7) return;

          const cellTexts = Array.from(cells).map((cell) => cell.innerText.trim());

          let ticketId = '';
          let customer = '';
          let agent = '';
          let status = '';
          let priority = '';
          let category = '';
          let subCategory = '';
          let subject = '';
          let createdDate = '';

          for (const text of cellTexts) {
            if (text.match(/TICKET-\d+/)) ticketId = text.match(/TICKET-\d+/)[0];
            if (['Open', 'Closed', 'Pending', 'Resolved'].includes(text)) status = text;
            if (['Low', 'Medium', 'High', 'Urgent'].includes(text)) priority = text;
          }

          if (cells.length >= 10) {
            ticketId = ticketId || cellTexts[1] || '';
            customer = cellTexts[2] || '';
            agent = cellTexts[3] || '';
            priority = priority || cellTexts[5] || '';
            status = status || cellTexts[6] || '';
            category = cellTexts[7] || '';
            subCategory = cellTexts[8] || '';
            subject = cellTexts[9] || '';
            createdDate = cellTexts[cells.length - 1] || '';
          }

          if (ticketId) {
            ticketData.push({ ticketId, customer, agent, status, priority, category, subCategory, subject, createdDate });
          }
        });

        return ticketData;
      });

      const enriched = pageTickets.map((ticket) => {
        const agentLines = ticket.agent.split('\n').map((l) => l.trim()).filter(Boolean);
        return { ...ticket, kantorPertanahan: agentLines[0] || '' };
      });

      allTickets.push(...enriched);

      // If no Open tickets on this page, stop pagination
      const pageOpen = enriched.filter((t) => t.status === 'Open');
      if (pageOpen.length === 0) break;
    }
  }

  const totalOpen = allTickets.filter((t) => t.status === 'Open');
  log.info(`Total scraped: ${allTickets.length} tickets, ${totalOpen.length} Open`);

  return allTickets;
}

module.exports = {
  scrapeTickets,
  scrapeAllOpenTickets,
  navigateToTicketPage,
};
