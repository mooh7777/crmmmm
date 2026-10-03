type Table<Row extends Record<string, unknown>> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type OrganizationRole = "owner" | "manager" | "sales";

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  timezone: "Africa/Cairo" | "Asia/Riyadh";
  currency: "EGP" | "SAR";
  weekend_days: number[];
  working_hours: {start: string; end: string};
  language: "ar" | "en";
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MembershipRow = {
  organization_id: string;
  user_id: string;
  role: OrganizationRole;
  is_active: boolean;
  created_at: string;
};

export type AutomationRuleRow = {
  organization_id: string;
  rule_key: string;
  enabled: boolean;
  configuration: Json;
  created_at: string;
  updated_at: string;
};

export type PipelineStageRow = {
  id: string;
  organization_id: string;
  name: string;
  name_ar: string;
  position: number;
  is_default: boolean;
  created_at: string;
};

export type BillingPlanRow = {
  code: "starter" | "growth" | "pro";
  name: string;
  included_seats: number;
  leads_per_month: number;
  monthly_price_egp: number;
  monthly_price_sar: number;
  extra_seat_price_egp: number;
  extra_seat_price_sar: number;
  features: Json;
  active: boolean;
  created_at: string;
};

export type SubscriptionRow = {
  id: string;
  organization_id: string;
  plan: "starter" | "growth" | "pro" | "enterprise";
  status: "trialing" | "active" | "past_due" | "canceled";
  trial_started_at: string;
  trial_ends_at: string;
  current_period_start: string | null;
  current_period_end: string | null;
  past_due_since: string | null;
  currency: "EGP" | "SAR";
  billing_interval: "monthly" | "annual";
  extra_seats: number;
  founder_discount_percent: number;
  created_at: string;
  updated_at: string;
};

export type BillingPaymentRow = {
  id: string;
  organization_id: string;
  subscription_id: string;
  provider: string;
  order_id: string;
  provider_transaction_id: string | null;
  plan_code: "starter" | "growth" | "pro";
  billing_interval: "monthly" | "annual";
  extra_seats: number;
  amount: number;
  currency: "EGP" | "SAR";
  period_start: string;
  period_end: string;
  status: "creating" | "pending" | "paid" | "failed" | "refunded";
  payment_url: string | null;
  created_at: string;
  paid_at: string | null;
  updated_at: string;
};

export type PaymentEventRow = {
  id: string;
  provider: string;
  event_id: string;
  order_id: string;
  transaction_id: string;
  payment_status: "approved" | "pending" | "rejected";
  amount: number;
  currency: "EGP" | "SAR" | null;
  raw_payload: string;
  received_at: string;
  processed_at: string | null;
  processing_error: string | null;
};

export type BillingReminderRow = {
  id: string;
  subscription_id: string;
  renewal_at: string;
  days_before: 5 | 2 | 0;
  payment_url: string | null;
  state: "pending" | "sent" | "failed";
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

export type ManagerDashboardMetrics = {
  average_first_response_minutes: number | null;
  response_trend: Array<{date: string; average_minutes: number | null; responses: number}>;
  untouched_past_sla: {
    count: number;
    leads: Array<{id: string; full_name: string; salesperson_email: string | null; due_at: string}>;
  };
  overdue_tasks_by_salesperson: Array<{user_id: string; email: string; task_count: number}>;
  funnel: Array<{stage_id: string; name: string; name_ar: string; lead_count: number}>;
};

export type ImpactStats = {
  lead_count: number;
  first_response_count: number;
  average_first_response_minutes: number | null;
  eligible_over_24h_count: number;
  untouched_over_24h_count: number;
  untouched_over_24h_percent: number | null;
};

export type ImpactDashboardSummary = {
  baseline_ready: boolean;
  baseline: {
    period_start: string;
    period_end: string;
    captured_at: string;
    lead_count: number;
    average_first_response_minutes: number | null;
    untouched_over_24h_percent: number | null;
  } | null;
  recent: ImpactStats;
  monthly_saved_leads: number;
  monthly_saved_by_reminder: number;
  monthly_saved_by_escalation: number;
  average_deal_value: number | null;
  close_rate_percent: number | null;
  estimated_revenue_protected: number | null;
  latest_report: Json | null;
};

export type LeadRow = {
  id: string;
  organization_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  source: string | null;
  property_interest: string | null;
  budget_min: number | null;
  budget_max: number | null;
  status: "new" | "contacted" | "qualified" | "won" | "lost";
  assignment_status: "assigned" | "pending";
  stage_id: string;
  assigned_to: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type TaskRow = {
  id: string;
  organization_id: string;
  lead_id: string;
  title: string;
  title_ar: string;
  assigned_to: string;
  created_by: string;
  due_at: string;
  last_activity_at: string;
  is_mandatory: boolean;
  completed_at: string | null;
  reminded_at: string | null;
  escalated_at: string | null;
  escalated_to: string | null;
  created_at: string;
  updated_at: string;
};

export type NotificationRow = {
  id: string;
  organization_id: string;
  recipient_id: string;
  task_id: string;
  kind: "task_due" | "task_escalated";
  title: string;
  title_ar: string;
  read_at: string | null;
  created_at: string;
};

export type SalesOutcome = "no_answer" | "interested" | "visit_booked" | "not_interested";

export type PushSubscriptionRow = {
  organization_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      organizations: Table<OrganizationRow>;
      memberships: Table<MembershipRow>;
      subscriptions: Table<SubscriptionRow>;
      billing_plans: Table<BillingPlanRow>;
      billing_payments: Table<BillingPaymentRow>;
      payments_events: Table<PaymentEventRow>;
      billing_reminders: Table<BillingReminderRow>;
      automation_rules: Table<AutomationRuleRow>;
      pipeline_stages: Table<PipelineStageRow>;
      leads: Table<LeadRow>;
      tasks: Table<TaskRow>;
      notifications: Table<NotificationRow>;
      push_subscriptions: Table<PushSubscriptionRow>;
    };
    Views: Record<string, never>;
    Functions: {
      create_organization: {
        Args: {
          organization_name: string;
          organization_timezone?: string;
          organization_currency?: string;
          organization_weekend_days?: number[];
          organization_working_hours?: {start: string; end: string};
          organization_language?: string;
        };
        Returns: string;
      };
      create_lead: {
        Args: {
          target_organization_id: string;
          lead_full_name: string;
          lead_phone: string;
          lead_email?: string | null;
          lead_source?: string | null;
          lead_property_interest?: string | null;
          requested_assignee_id?: string | null;
        };
        Returns: {
          id: string;
          duplicate: boolean;
          assigned_to: string;
        };
      };
      import_leads: {
        Args: {target_organization_id: string; rows_payload: Json};
        Returns: {
          created: number;
          duplicates: number;
          failed: number;
          errors: Array<{row: number; reason: string}>;
        };
      };
      save_workflow_settings: {
        Args: {
          target_organization_id: string;
          organization_name: string;
          organization_timezone: string;
          organization_currency: string;
          organization_language: string;
          organization_weekend_days: number[];
          organization_working_hours: {start: string; end: string};
          follow_up_minutes: number;
          escalation_minutes: number;
          auto_assign_enabled: boolean;
          active_sales_ids: string[];
        };
        Returns: undefined;
      };
      get_workflow_sales_members: {
        Args: {target_organization_id: string};
        Returns: Array<{sales_user_id: string; sales_email: string; is_active: boolean}>;
      };
      get_manager_dashboard_metrics: {
        Args: {
          target_organization_id: string;
          start_date: string;
          end_date: string;
          target_stage_id?: string | null;
          target_salesperson_id?: string | null;
        };
        Returns: ManagerDashboardMetrics;
      };
      get_impact_assumptions: {
        Args: {target_organization_id: string};
        Returns: Json;
      };
      log_sales_outcome: {
        Args: {
          target_organization_id: string;
          target_lead_id: string;
          target_interaction_id: string;
          target_outcome: SalesOutcome;
        };
        Returns: undefined;
      };
      create_sales_invite: {
        Args: {target_organization_id: string; target_token_hash: string};
        Returns: string;
      };
      accept_organization_invite: {
        Args: {invite_token: string};
        Returns: string;
      };
      activate_default_lead_workflow: {
        Args: {target_organization_id: string};
        Returns: undefined;
      };
      save_impact_assumptions: {
        Args: {
          target_organization_id: string;
          assumed_average_deal_value: number;
          assumed_close_rate_percent: number;
        };
        Returns: undefined;
      };
      get_impact_dashboard_summary: {
        Args: {target_organization_id: string};
        Returns: ImpactDashboardSummary;
      };
      rotate_organization_webhook_secret: {
        Args: {target_organization_id: string};
        Returns: string;
      };
      ingest_webhook_lead: {
        Args: {
          target_organization_id: string;
          supplied_secret: string;
          lead_full_name: string;
          lead_phone: string;
          lead_email?: string | null;
          lead_source?: string | null;
          lead_property_interest?: string | null;
        };
        Returns: {
          id: string;
          duplicate: boolean;
          assigned_to: string;
        };
      };
      get_org_role: {
        Args: {target_organization_id: string};
        Returns: OrganizationRole | null;
      };
      apply_truepay_payment_event: {
        Args: {target_event_id: string};
        Returns: string;
      };
      process_billing_renewals: {
        Args: {run_at?: string};
        Returns: number;
      };
      claim_billing_reminders: {
        Args: {batch_size?: number};
        Returns: Array<{
          reminder_id: string;
          subscription_id: string;
          organization_id: string;
          organization_name: string;
          organization_language: string;
          recipient_email: string;
          payment_url: string;
          renewal_at: string;
          days_before: number;
        }>;
      };
      finish_billing_reminder: {
        Args: {target_reminder_id: string; delivery_error?: string | null};
        Returns: undefined;
      };
    };
    Enums: {
      organization_role: OrganizationRole;
    };
    CompositeTypes: Record<string, never>;
  };
};

type Json = string | number | boolean | null | Json[] | {[key: string]: Json | undefined};