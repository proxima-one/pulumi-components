import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as random from '@pulumi/random';
import * as abstractions from '../abstractions';
import {merge} from 'lodash';

export interface GrafanaInputs {
  namespace?: pulumi.Input<string>;
  helmOverride?: abstractions.HelmOverride;
  /**
   * import dasboards into grafana.
   * defaults to undefined.
   */
  dashboards?: Array<GrafanaDashboard>;
  /**
   * grafana datasources
   */
  datasources?: GrafanaDataSource[];
  /**
   * grafana plugins
   */
  plugins?: string[];
  /**
   * allowAnonymousAccess configures grafana so that
   * users can access it without needing to login.
   * defaults to false
   */
  allowAnonymousAccess?: boolean;
  /**
   *
   */
  grafanaConfig?: pulumi.Input<Record<string, pulumi.Input<any>>>;
  /**
   * ingress resource configuration
   * defaults to undefined (no ingress resource will be created)
   */
  ingress?: abstractions.Ingress;
  /**
   * persistent storage configuration
   * defaults to undefined (no persistent storage will be used)
   */
  persistence?: abstractions.Persistence;
}

export type GrafanaDashboard = { name: string } & (
  | { json: string }
  | { file: string }
  | { gnetId: number; revision?: number; datasource?: string }
  | { url: string; b64content?: boolean }
  );

export interface GrafanaOutputs {
  meta: pulumi.Output<abstractions.HelmMeta>;
  adminUsername: pulumi.Output<string>;
  adminPassword: pulumi.Output<string>;
  ingress: pulumi.Output<abstractions.Ingress | undefined>;
  persistence: pulumi.Output<abstractions.Persistence | undefined>;
}

export interface GrafanaDataSource {
  name: string;
  type: 'prometheus' | 'loki';
  url: string;
}

export class Grafana extends pulumi.ComponentResource implements GrafanaOutputs {
  readonly meta: pulumi.Output<abstractions.HelmMeta>;
  readonly adminUsername: pulumi.Output<string>;
  readonly adminPassword: pulumi.Output<string>;
  readonly ingress: pulumi.Output<abstractions.Ingress | undefined>;
  readonly persistence: pulumi.Output<abstractions.Persistence | undefined>;

  constructor(name: string, args: GrafanaInputs, opts?: pulumi.ComponentResourceOptions) {
    super('proxima-k8s:Grafana', name, args, opts);

    this.ingress = pulumi.output(args.ingress);
    this.persistence = pulumi.output(args.persistence);

    const password = new random.RandomPassword(
      `${name}-admin-password`,
      {
        length: 32,
        special: false,
      },
      {
        parent: this,
      }
    );

    this.adminUsername = pulumi.output('admin');
    this.adminPassword = pulumi.secret(password.result);

    const config = pulumi.output(args.ingress?.hosts).apply((hosts) => ({
      server: hosts && {
        domain: hosts[0],
        root_url: `https://${hosts[0]}`,
      },
      'auth.anonymous': {
        enabled: args.allowAnonymousAccess ? 'true' : 'false',
        org_name: 'Main Org.',
        org_role: 'Editor',
      },
      'auth.basic': {
        enabled: 'false',
      },
    }));

    const grafanaIni = pulumi
      .all([config, args.grafanaConfig || {}])
      .apply(([base, extra]) => merge({}, base, extra));

    this.meta = pulumi.output<abstractions.HelmMeta>({
      chart: 'grafana',
      version: args.helmOverride?.version ?? '6.21.5',
      repo: 'https://grafana.github.io/helm-charts',
    });

    const grafana = new k8s.helm.v3.Chart(name, {
      namespace: args.namespace,
      chart: this.meta.chart,
      version: this.meta.version,
      fetchOpts: {
        repo: this.meta.repo,
      },
      values: merge({}, {
        adminUser: this.adminUsername,
        adminPassword: this.adminPassword,
        ingress: args.ingress ? {
          enabled: args.ingress.enabled ?? true,
          annotations: {
            'kubernetes.io/ingress.class': args.ingress.class ?? 'nginx',
            'kubernetes.io/tls-acme': args.ingress.tls === false ? 'false' : 'true', // "tls" defaults to true, so we'll activate tls for undefined or null values
            ...args.ingress.annotations,
          },
          hosts: args.ingress.hosts,
          tls: [
            {
              hosts: args.ingress.hosts,
              secretName: `tls-grafana-${name}`,
            },
          ],
        } : {enabled: false},
        deploymentStrategy: {
          type: 'Recreate',
        },
        persistence: args.persistence ? {
          enabled: args.persistence.enabled,
          size: pulumi.interpolate`${args.persistence.sizeGB}Gi`,
          storageClass: args.persistence.storageClass,
        } : {enabled: false},
        testFramework: {
          enabled: false,
        },
        'grafana.ini': grafanaIni,
        datasources: {
          'datasources.yaml': {
            apiVersion: 1,
            datasources: args.datasources ? args.datasources.map((datasource) => ({
              name: datasource.name,
              type: datasource.type,
              url: datasource.url,
              access: 'proxy',
              basicAuth: false,
              editable: false,
            })) : [],
          },
        },
        dashboards: args.dashboards ? {
          default: args.dashboards.reduce((prev, curr) => {
            const {name, ...rest} = curr;
            return {...prev, [name]: rest};
          }, {})
        } : undefined,
        dashboardProviders: args.dashboards ? {
          'dashboardproviders.yaml': {
            apiVersion: 1,
            providers: [
              {
                name: 'default',
                orgId: 1,
                folder: '',
                type: 'file',
                disableDeletion: false,
                editable: true,
                options: {
                  path: '/var/lib/grafana/dashboards/default',
                },
              },
            ],
          },
        } : undefined,
        plugins: args.plugins,
      }, args.helmOverride),
    }, {parent: this});
  }
}
