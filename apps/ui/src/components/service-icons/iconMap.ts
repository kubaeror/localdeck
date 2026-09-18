// Used in a `typeof` type query, so it stays a type-only import.
import type { ServiceCatalogIconKey } from '@localdeck/shared';
import {
  Activity,
  Archive,
  ArrowLeftRight,
  ArrowUpDown,
  BadgeCheck,
  Bell,
  Blocks,
  BookOpen,
  Box,
  Boxes,
  Braces,
  Brain,
  Bug,
  Building2,
  Calculator,
  Camera,
  ClipboardCheck,
  Clock,
  Code,
  Coins,
  Compass,
  Container,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  Flame,
  Gauge,
  GitBranch,
  GitPullRequest,
  Globe,
  Hammer,
  HardDrive,
  History,
  Home,
  IdCard,
  Inbox,
  KeyRound,
  Languages,
  LayoutGrid,
  Layers,
  LifeBuoy,
  Lightbulb,
  Lock,
  Mail,
  Microscope,
  Mic,
  Network,
  Package,
  Plug,
  Presentation,
  Puzzle,
  Radar,
  Radio,
  RadioTower,
  RefreshCw,
  Rocket,
  Route,
  ScanText,
  Search,
  Send,
  Server,
  Share2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Ship,
  SlidersHorizontal,
  Snowflake,
  Sparkles,
  Tags,
  Truck,
  UserCog,
  Users,
  Waves,
  Webhook,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icons the console chrome renders next to registry services.
 */
export const CONSOLE_ICON_KEYS = ['console-home', 'service-health', 'all-services'] as const;
export type ConsoleIconKey = (typeof CONSOLE_ICON_KEYS)[number];

/**
 * Every icon key the console can render: the registry's service icon keys plus
 * the chrome keys. Derived from `SERVICE_CATALOG`, so adding a service to the
 * registry immediately requires an icon (the Lucide map below is checked by
 * `iconMap.test.ts`).
 */
export type ServiceIconKey = ServiceCatalogIconKey | ConsoleIconKey;

/**
 * Official AWS Architecture Icon file, relative to `src/assets/aws-icons/`
 * (for example `Arch_Storage/Res_Amazon-Simple-Storage-Service_Bucket_48.svg`).
 */
export type AwsIconFile = `${string}.svg`;

/**
 * Typed map from icon key to the official artwork. The asset pack is not
 * vendored yet (see `src/assets/aws-icons/README.md`); entries that are present
 * win over the tolerant file-name lookup, and anything missing falls back to
 * the Lucide glyph below. Extend this map when the pack lands.
 */
export type AwsIconMap = Readonly<Partial<Record<ServiceIconKey, AwsIconFile>>>;

export const AWS_ICON_MAP: AwsIconMap = {
  s3: 'Arch_Storage/Res_Amazon-Simple-Storage-Service_Bucket_48.svg',
  ec2: 'Arch_Compute/Res_Amazon-EC2_Instance_48.svg',
  lambda: 'Arch_Compute/Res_Amazon-Lambda_Lambda-Function_48.svg',
  dynamodb: 'Arch_Database/Res_Amazon-DynamoDB_Table_48.svg',
  sqs: 'Arch_Application-Integration/Res_Amazon-Simple-Queue-Service_Queue_48.svg',
  sns: 'Arch_Application-Integration/Res_Amazon-Simple-Notification-Service_Topic_48.svg',
  iam: 'Arch_Security-Identity-Compliance/Res_AWS-Identity-and-Access-Management_Role_48.svg',
  cloudfront: 'Arch_Networking-Content-Delivery/Res_Amazon-CloudFront_Edge-Location_48.svg',
  route53: 'Arch_Networking-Content-Delivery/Res_Amazon-Route-53_Hosted-Zone_48.svg',
  cloudwatch: 'Arch_Management-Governance/Res_Amazon-CloudWatch_Alarm_48.svg',
};

/**
 * Lucide stand-ins, chosen to read like the official service glyphs.
 *
 * Partial on purpose: a freshly generated service renders its category glyph
 * until someone maps a dedicated icon, so scaffolding never breaks the build.
 * `ServiceIcon.test.tsx` checks that every registry key resolves.
 */
export const LUCIDE_ICON_MAP: Readonly<Partial<Record<ServiceIconKey, LucideIcon>>> = {
  // Console chrome
  'console-home': Home,
  'service-health': Activity,
  'all-services': LayoutGrid,
  // Compute
  ec2: Server,
  lambda: Zap,
  batch: Boxes,
  elasticbeanstalk: Rocket,
  lightsail: Lightbulb,
  autoscaling: Gauge,
  // Containers
  ecs: Container,
  ecr: Package,
  eks: Boxes,
  managedblockchain: Boxes,
  // Storage
  s3: Archive,
  efs: HardDrive,
  fsx: HardDrive,
  storagegateway: Ship,
  glacier: Snowflake,
  backup: History,
  transfer: ArrowLeftRight,
  datasync: RefreshCw,
  // Database
  dynamodb: Database,
  rds: Database,
  dsql: Database,
  docdb: FileText,
  elasticache: Flame,
  memorydb: Flame,
  neptune: Share2,
  redshift: Database,
  timestream: Clock,
  dms: ArrowUpDown,
  keyspaces: Database,
  // Networking & CDN
  cloudfront: Globe,
  route53: Compass,
  elbv2: Network,
  apigateway: Webhook,
  servicediscovery: Radar,
  globalaccelerator: Gauge,
  // Security Identity & Compliance
  iam: Users,
  sts: IdCard,
  kms: KeyRound,
  secretsmanager: Lock,
  acm: ShieldCheck,
  cognito: UserCog,
  wafv2: Shield,
  shield: Shield,
  verifiedpermissions: BadgeCheck,
  guardduty: ShieldAlert,
  inspector: Bug,
  'sso-admin': KeyRound,
  ram: Share2,
  account: Building2,
  // Application Integration
  sqs: Inbox,
  sns: Bell,
  eventbridge: Radio,
  stepfunctions: Workflow,
  appsync: Braces,
  mq: RadioTower,
  swf: Route,
  appconfig: SlidersHorizontal,
  ses: Mail,
  serverlessrepo: Package,
  pinpoint: Send,
  iot: RadioTower,
  // Analytics
  athena: Calculator,
  glue: Puzzle,
  emr: Cpu,
  kinesis: Waves,
  firehose: Send,
  opensearch: Search,
  lakeformation: Layers,
  quicksight: Presentation,
  kafka: Flame,
  mwaa: Workflow,
  mediaconvert: Camera,
  // Management & Governance
  cloudwatch: Activity,
  cloudformation: Blocks,
  ssm: Wrench,
  cloudtrail: History,
  config: ClipboardCheck,
  organizations: Building2,
  ce: Coins,
  support: LifeBuoy,
  fis: FlaskConical,
  cloudcontrol: Plug,
  tagging: Tags,
  'resource-groups': Tags,
  servicecatalog: Box,
  // Developer Tools
  codecommit: GitBranch,
  codebuild: Hammer,
  codedeploy: Truck,
  codepipeline: GitPullRequest,
  codeartifact: Box,
  xray: Microscope,
  cloud9: Code,
  amplify: Rocket,
  // Machine Learning
  sagemaker: Brain,
  bedrock: Sparkles,
  textract: ScanText,
  transcribe: Mic,
  rekognition: Camera,
  comprehend: BookOpen,
  translate: Languages,
};

/** Used when a module declares an icon key the console has no glyph for. */
export const DEFAULT_ICON: LucideIcon = LayoutGrid;

/**
 * Every SVG dropped into `src/assets/aws-icons/`, as `{ path: url }`. Empty
 * while the asset pack is not vendored.
 */
export const VENDORED_AWS_ICON_FILES: Readonly<Record<string, string>> = import.meta.glob(
  '../../assets/aws-icons/**/*.svg',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

const IGNORED_FILE_TOKENS = new Set([
  'am',
  'arch',
  'aws',
  'amazon',
  'res',
  'svg',
  '48',
  '64',
  '16',
  '32',
]);

/** Words inside an official AWS icon file name, e.g. `ec2`, `bucket`. */
export function tokenizeIconPath(path: string): readonly string[] {
  const baseName = path.slice(path.lastIndexOf('/') + 1).replace(/\.svg$/i, '');
  return baseName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !IGNORED_FILE_TOKENS.has(token));
}

/**
 * Best-effort lookup for vendored artwork: `iconKey` wins if any file name
 * contains it as a word (`…_EC2_Instance_48.svg` answers for `ec2`).
 */
export function matchVendoredIcon(
  files: Readonly<Record<string, string>>,
  iconKey: string,
): string | undefined {
  const wanted = iconKey.toLowerCase();
  for (const path of Object.keys(files).sort()) {
    if (tokenizeIconPath(path).includes(wanted)) return files[path];
  }
  return undefined;
}

/**
 * Resolves the official artwork for an icon key: the typed map first, then the
 * vendored files. `undefined` means "use the Lucide fallback".
 */
export function resolveAwsIconUrl(
  iconKey: string,
  files: Readonly<Record<string, string>> = VENDORED_AWS_ICON_FILES,
): string | undefined {
  const mapped = AWS_ICON_MAP[iconKey as ServiceIconKey];
  if (mapped !== undefined) {
    const url = files[mapped];
    if (url !== undefined) return url;
  }
  return matchVendoredIcon(files, iconKey);
}

/** Lucide glyph for an icon key, with an optional second-chance key. */
export function lucideIconFor(iconKey: string, fallbackIconKey?: string): LucideIcon {
  const direct = LUCIDE_ICON_MAP[iconKey as ServiceIconKey];
  if (direct !== undefined) return direct;
  const fallback =
    fallbackIconKey === undefined ? undefined : LUCIDE_ICON_MAP[fallbackIconKey as ServiceIconKey];
  return fallback ?? DEFAULT_ICON;
}
