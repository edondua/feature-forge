import { Card, CardContent, CardHeader, CardTitle, Badge } from '@appmirror/ui-kit';
import type { ComponentSpec } from '../../types/design-audit';

interface SpecViewerProps {
  spec: ComponentSpec;
}

export default function SpecViewer({ spec }: SpecViewerProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Badge variant={spec.platform === 'ios' ? 'secondary' : 'primary'}>
          {spec.platform === 'ios' ? 'iOS' : 'Android'}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Generated {new Date(spec.generatedAt).toLocaleDateString()}
        </span>
      </div>

      {/* Anatomy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Anatomy</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {spec.anatomy.map((part, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${part.required ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
                <div>
                  <span className="text-sm font-medium">{part.name}</span>
                  {!part.required && <span className="text-xs text-muted-foreground ml-1">(optional)</span>}
                  <p className="text-xs text-muted-foreground">{part.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Props / API */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">API / Props</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Name</th>
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Type</th>
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Default</th>
                  <th className="text-left py-2 font-medium text-muted-foreground">Description</th>
                </tr>
              </thead>
              <tbody>
                {spec.props.map((prop, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-mono text-primary">{prop.name}</td>
                    <td className="py-2 pr-4 font-mono text-muted-foreground">{prop.type}</td>
                    <td className="py-2 pr-4 font-mono">{prop.defaultValue || '—'}</td>
                    <td className="py-2 text-muted-foreground">{prop.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Variants */}
      {spec.variants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Variants</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {spec.variants.map((variant, i) => (
                <div key={i}>
                  <div className="text-sm font-medium">{variant.name}</div>
                  <p className="text-xs text-muted-foreground mb-1">{variant.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {variant.values.map((val, j) => (
                      <span key={j} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {val}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Colors */}
      {spec.colors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Colors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {spec.colors.map((color, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div
                    className="w-6 h-6 rounded border border-border flex-shrink-0"
                    style={{ backgroundColor: color.hex }}
                  />
                  <div className="min-w-0">
                    <span className="text-xs font-mono">{color.token}</span>
                    <span className="text-xs text-muted-foreground ml-2">{color.hex}</span>
                    <p className="text-xs text-muted-foreground truncate">{color.usage}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Spacing */}
      {spec.spacing.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Spacing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-1">
              {spec.spacing.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-primary w-24 flex-shrink-0">{s.property}</span>
                  <span className="font-mono w-16 flex-shrink-0">{s.value}</span>
                  <span className="text-muted-foreground">{s.description}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Accessibility */}
      {spec.accessibility.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Accessibility</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {spec.accessibility.map((req, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Badge variant="secondary" className="text-[10px] flex-shrink-0 mt-0.5">
                    {req.wcagLevel}
                  </Badge>
                  <div>
                    <span className="text-xs font-medium">{req.rule}</span>
                    <p className="text-xs text-muted-foreground">{req.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Usage Guidelines */}
      {spec.usageGuidelines && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Usage Guidelines</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground whitespace-pre-line">{spec.usageGuidelines}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
