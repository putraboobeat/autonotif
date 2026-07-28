/**
 * SLA & Analytics Calculation Service (Level 6: Advanced SLA Analytics)
 * Computes response speed, resolution rate, and ranks all 24 Kantor Pertanahan in Aceh.
 */
const { TicketModel, AdminModel } = require('../database/models');
const { createLogger } = require('../utils/logger');

const log = createLogger('ANALYTICS_SLA');

function parseDateSafe(dateStr) {
  if (!dateStr || dateStr === '-' || dateStr === '--') return null;
  // Try direct date creation or parsing common ID formats
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
}

function getSlaMetrics() {
  try {
    const allTickets = TicketModel.getAll() || [];
    const allAdmins = AdminModel.getAll() || [];

    // Map of office name -> stats object
    const officeMap = new Map();

    // Initialize all registered offices from AdminModel so none are left behind
    allAdmins.forEach(admin => {
      const officeName = admin.kantor_pertanahan || 'Tidak Diketahui';
      if (!officeMap.has(officeName)) {
        officeMap.set(officeName, {
          kantor: officeName,
          totalTickets: 0,
          openTickets: 0,
          closedTickets: 0,
          escalatedTickets: 0,
          totalDurationHours: 0,
          durationCount: 0,
          onTimeTickets: 0,
          adminNames: [],
          adminPhones: []
        });
      }
      const item = officeMap.get(officeName);
      if (!item.adminNames.includes(admin.nama)) item.adminNames.push(admin.nama);
      if (!item.adminPhones.includes(admin.no_hp)) item.adminPhones.push(admin.no_hp);
    });

    const now = new Date();

    allTickets.forEach(t => {
      const kantor = t.kantor_pertanahan || 'Kanwil BPN Prov. Aceh (Umum)';
      if (!officeMap.has(kantor)) {
        officeMap.set(kantor, {
          kantor: kantor,
          totalTickets: 0,
          openTickets: 0,
          closedTickets: 0,
          escalatedTickets: 0,
          totalDurationHours: 0,
          durationCount: 0,
          onTimeTickets: 0,
          adminNames: ['Wilayah Belum Terdaftar'],
          adminPhones: []
        });
      }

      const stats = officeMap.get(kantor);
      stats.totalTickets++;

      const isClosed = t.status === 'Closed' || t.status === 'Resolved';
      if (isClosed) {
        stats.closedTickets++;
      } else {
        stats.openTickets++;
      }

      if (t.reminder_count >= 3 || (t.priority && t.priority.toLowerCase().includes('urgent'))) {
        stats.escalatedTickets++;
      }

      const created = parseDateSafe(t.created_date) || parseDateSafe(t.notified_at) || now;
      const refTime = isClosed ? (parseDateSafe(t.last_update) || now) : now;
      const hoursDiff = Math.max(0, (refTime.getTime() - created.getTime()) / (1000 * 60 * 60));

      stats.totalDurationHours += hoursDiff;
      stats.durationCount++;

      if (hoursDiff <= 24 || isClosed) {
        stats.onTimeTickets++;
      } else {
        stats.escalatedTickets++;
      }
    });

    // Convert map to array and finalize metrics
    const rankingList = Array.from(officeMap.values()).map(stats => {
      const avgHours = stats.durationCount > 0 ? (stats.totalDurationHours / stats.durationCount).toFixed(1) : '0.0';
      const resolutionRate = stats.totalTickets > 0 ? Math.round((stats.closedTickets / stats.totalTickets) * 100) : 100;
      const onTimeRate = stats.totalTickets > 0 ? Math.round((stats.onTimeTickets / stats.totalTickets) * 100) : 100;

      let statusBadge = 'EXCELLENT'; // Green
      let statusText = 'Sangat Responsif (< 4 Jam)';
      if (stats.openTickets > 0 || stats.escalatedTickets > 0) {
        if (stats.escalatedTickets > 0 || parseFloat(avgHours) > 24) {
          statusBadge = 'CRITICAL'; // Red / Attention needed
          statusText = 'Perlu Eskalasi & Pembinaan (> 24 Jam)';
        } else {
          statusBadge = 'GOOD'; // Yellow / On progress
          statusText = 'Dalam Penanganan Normal (< 24 Jam)';
        }
      }

      return {
        ...stats,
        avgHours: parseFloat(avgHours),
        resolutionRate,
        onTimeRate,
        statusBadge,
        statusText,
        adminListText: stats.adminNames.join(', ')
      };
    });

    // Sort by Best (Top Responders)
    const topResponders = [...rankingList].sort((a, b) => {
      if (b.resolutionRate !== a.resolutionRate) return b.resolutionRate - a.resolutionRate;
      if (a.openTickets !== b.openTickets) return a.openTickets - b.openTickets;
      return a.avgHours - b.avgHours;
    }).slice(0, 5);

    // Sort by Attention Needed
    const attentionNeeded = [...rankingList]
      .filter(item => item.openTickets > 0 || item.escalatedTickets > 0 || item.avgHours > 24)
      .sort((a, b) => {
        if (b.escalatedTickets !== a.escalatedTickets) return b.escalatedTickets - a.escalatedTickets;
        if (b.openTickets !== a.openTickets) return b.openTickets - a.openTickets;
        return b.avgHours - a.avgHours;
      }).slice(0, 10);

    const totalGlobalTickets = rankingList.reduce((acc, curr) => acc + curr.totalTickets, 0);
    const totalGlobalOpen = rankingList.reduce((acc, curr) => acc + curr.openTickets, 0);
    const totalGlobalClosed = rankingList.reduce((acc, curr) => acc + curr.closedTickets, 0);
    const totalGlobalEscalated = rankingList.reduce((acc, curr) => acc + curr.escalatedTickets, 0);
    const avgGlobalHours = rankingList.length > 0 
      ? (rankingList.reduce((acc, curr) => acc + curr.avgHours, 0) / rankingList.length).toFixed(1) 
      : '0.0';

    return {
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        totalTickets: totalGlobalTickets,
        openTickets: totalGlobalOpen,
        closedTickets: totalGlobalClosed,
        escalatedTickets: totalGlobalEscalated,
        avgResolutionHours: parseFloat(avgGlobalHours),
        globalResolutionRate: totalGlobalTickets > 0 ? Math.round((totalGlobalClosed / totalGlobalTickets) * 100) : 100
      },
      topResponders,
      attentionNeeded,
      allOffices: rankingList
    };
  } catch (err) {
    log.error('Failed to compute SLA metrics', { error: err.message });
    return {
      success: false,
      error: err.message,
      summary: { totalTickets: 0, openTickets: 0, closedTickets: 0, escalatedTickets: 0, avgResolutionHours: 0, globalResolutionRate: 100 },
      topResponders: [],
      attentionNeeded: [],
      allOffices: []
    };
  }
}

module.exports = {
  getSlaMetrics
};
