import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';

const traceExporter = new OTLPTraceExporter({
  url: process.env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
});

export const otelSDK = new NodeSDK({
  resource: resourceFromAttributes({
    'service.name': 'antd-backend',
    'service.version': '0.0.1',
  }),
  traceExporter,
  instrumentations: [getNodeAutoInstrumentations()],
});

process.on('SIGTERM', () => {
  otelSDK
    .shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});

if (process.env.ENABLE_TRACING === 'true') {
  otelSDK.start();
  console.log('OpenTelemetry SDK started');
}
