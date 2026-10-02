import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgId, RequirePermissions } from '../../common/request-context';
import { AnalyticsService } from './analytics.service';
import { EventsService } from './events.service';

@ApiTags('Analytics')
@Controller('v1/analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly events: EventsService,
  ) {}

  @Get('overview')
  @RequirePermissions('analytics:read')
  @ApiOperation({ summary: 'Issuance and engagement summary for the workspace' })
  overview(
    @OrgId() organizationId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.overview(organizationId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Get('timeseries')
  @RequirePermissions('analytics:read')
  timeseries(@OrgId() organizationId: string, @Query('days') days?: string) {
    return this.analytics.timeseries(organizationId, {
      days: days ? Number(days) : undefined,
    });
  }

  @Get('credentials/:id/events')
  @RequirePermissions('analytics:read')
  @ApiOperation({ summary: 'The full event history for one credential (FR-ANA-01)' })
  credentialEvents(@Param('id') id: string) {
    return this.events.timeline(id);
  }

  @Get('batches/:id')
  @RequirePermissions('analytics:read')
  @ApiOperation({ summary: 'Rollup reporting for one issuance batch (FR-ANA-02)' })
  batchReport(@OrgId() organizationId: string, @Param('id') id: string) {
    return this.analytics.batchReport(organizationId, id);
  }

  @Get('export.csv')
  @RequirePermissions('analytics:read')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="opencred-events.csv"')
  @ApiOperation({ summary: 'Export the raw event log as CSV (FR-ANA-03)' })
  export(
    @OrgId() organizationId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.exportEvents(organizationId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }
}
