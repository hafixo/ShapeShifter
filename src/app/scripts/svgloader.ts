import { Layer, VectorLayer, GroupLayer, PathLayer } from './layers';
import * as ColorUtil from './colorutil';
import { createPathCommand } from './svgpathdata';
import * as PathParser from './pathparser';
import * as MathUtil from './mathutil';
import { EllipticalArcCommand } from './svgpathdata';
import * as SvgUtil from './svgutil';

/**
 * Utility function that takes an SVG string as input and returns a VectorLayer model object.
 */
export function loadVectorLayerFromSvgString(svgString: string): VectorLayer {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');

  const sanitizeId_ = (value: string) => {
    return (value || '')
      .toLowerCase()
      .replace(/^\s+|\s+$/g, '')
      .replace(/[\s-]+/g, '_')
      .replace(/[^\w_]+/g, '');
  };

  const usedIds = {};

  const makeFinalNodeId_ = (node, typeIdPrefix: string) => {
    const finalId = getUniqueId(
      sanitizeId_(node.id || typeIdPrefix),
      id => usedIds[id],
    );
    usedIds[finalId] = true;
    return finalId;
  };

  const lengthPx_ = svgLength => {
    if (svgLength.baseVal) {
      svgLength = svgLength.baseVal;
    }
    svgLength.convertToSpecifiedUnits(SVGLength.SVG_LENGTHTYPE_PX);
    return svgLength.valueInSpecifiedUnits;
  };

  const nodeToLayerData_ = (node, context): Layer => {
    if (!node) {
      return null;
    }

    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) {
      return null;
    }

    const simpleAttr_ = (nodeAttr, contextAttr) => {
      if (node.attributes[nodeAttr]) {
        context[contextAttr] = node.attributes[nodeAttr].value;
      }
    };

    // set attributes
    simpleAttr_('stroke', 'strokeColor');
    simpleAttr_('stroke-width', 'strokeWidth');
    simpleAttr_('stroke-linecap', 'strokeLinecap');
    simpleAttr_('stroke-linejoin', 'strokeLinejoin');
    simpleAttr_('stroke-miterlimit', 'strokeMiterLimit');
    simpleAttr_('stroke-opacity', 'strokeAlpha');
    simpleAttr_('fill', 'fillColor');
    simpleAttr_('fill-opacity', 'fillAlpha');

    // add transforms
    if (node.transform) {
      const transforms = Array.from(node.transform.baseVal).reverse();
      context.transforms = context.transforms ? context.transforms.slice() : [];
      context.transforms.splice(0, 0, ...transforms);
    }

    // see if this is a path
    let path;
    if (node instanceof SVGPathElement) {
      path = (<any>node.attributes).d.value;

    } else if (node instanceof SVGRectElement) {
      const l = lengthPx_(node.x),
        t = lengthPx_(node.y),
        r = l + lengthPx_(node.width),
        b = t + lengthPx_(node.height);
      path = `M ${l},${t} ${r},${t} ${r},${b} ${l},${b} Z`;

    } else if (node instanceof SVGLineElement) {
      const x1 = lengthPx_(node.x1),
        y1 = lengthPx_(node.y1),
        x2 = lengthPx_(node.x2),
        y2 = lengthPx_(node.y2);
      path = `M ${x1},${y1} ${x2},${y2} Z`;

    } else if (node instanceof SVGPolygonElement || node instanceof SVGPolylineElement) {
      path = 'M ' + Array.from(<any>(node.points)).map((pt: any) => pt.x + ',' + pt.y).join(' ');
      if (node instanceof SVGPolygonElement) {
        path += ' Z';
      }

    } else if (node instanceof SVGCircleElement) {
      const cx = lengthPx_(node.cx),
        cy = lengthPx_(node.cy),
        r = lengthPx_(node.r);
      path = `M ${cx},${cy - r} A ${r} ${r} 0 1 0 ${cx},${cy + r} A ${r} ${r} 0 1 0 ${cx},${cy - r} Z`;

    } else if (node instanceof SVGEllipseElement) {
      const cx = lengthPx_(node.cx),
        cy = lengthPx_(node.cy),
        rx = lengthPx_(node.rx),
        ry = lengthPx_(node.ry);
      path = `M ${cx},${cy - ry} A ${rx} ${ry} 0 1 0 ${cx},${cy + ry} ` +
        `A ${rx} ${ry} 0 1 0 ${cx},${cy - ry} Z`;
    }

    if (path) {
      // transform all points
      if (context.transforms && context.transforms.length) {
        const commands = PathParser.parseCommands(path);
        const matrices = context.transforms.map(t => t.matrix);
        commands.forEach(c => {
          if (c instanceof EllipticalArcCommand) {
            const start = MathUtil.transform({ x: c.args[0], y: c.args[1] }, ...matrices);
            c.args[0] = start.x;
            c.args[1] = start.y;
            const arc = SvgUtil.transformArc({
              rx: c.args[2],
              ry: c.args[3],
              xAxisRotation: c.args[4],
              largeArcFlag: c.args[5],
              sweepFlag: c.args[6],
              endX: c.args[7],
              endY: c.args[8],
            }, matrices);
            c.args[2] = arc.rx;
            c.args[3] = arc.ry;
            c.args[4] = arc.xAxisRotation;
            c.args[5] = arc.largeArcFlag;
            c.args[6] = arc.sweepFlag;
            c.args[7] = arc.endX;
            c.args[8] = arc.endY;
          } else {
            for (let i = 0; i < c.points.length; i++) {
              if (c.points[i]) {
                c.points[i] = MathUtil.transform(c.points[i], ...matrices);
              }
            }
          }
        });
        path = PathParser.commandsToString(commands);
      }

      // create a path layer
      return new PathLayer(
        makeFinalNodeId_(node, 'path'),
        createPathCommand(path),
        ('fillColor' in context) ? ColorUtil.svgToAndroidColor(context.fillColor) : null,
        ('fillAlpha' in context) ? context.fillAlpha : undefined,
        ('strokeColor' in context) ? ColorUtil.svgToAndroidColor(context.strokeColor) : null,
        ('strokeAlpha' in context) ? context.strokeAlpha : undefined,
        context.strokeWidth || undefined,
        context.strokeLinecap || undefined,
        context.strokeLinejoin || undefined,
        context.strokeMiterLimit || undefined,
      );
    }

    if (node.childNodes.length) {
      const layers = Array.from(node.childNodes)
        .map(child => nodeToLayerData_(child, Object.assign({}, context)))
        .filter(layer => !!layer);
      if (layers && layers.length) {
        // create a group (there are valid children)
        return new GroupLayer(
          layers,
          makeFinalNodeId_(node, 'group'),
        );
      }
    }

    return null;
  };

  const docElContext: any = {};
  const documentElement: any = doc.documentElement;
  let width = lengthPx_(documentElement.width);
  let height = lengthPx_(documentElement.height);

  if (documentElement.viewBox) {
    width = documentElement.viewBox.baseVal.width;
    height = documentElement.viewBox.baseVal.height;

    // fake a translate transform for the viewbox
    docElContext.transforms = [
      {
        matrix: {
          a: 1,
          b: 0,
          c: 0,
          d: 1,
          e: -documentElement.viewBox.baseVal.x,
          f: -documentElement.viewBox.baseVal.y
        }
      }
    ];
  }

  const rootLayer = nodeToLayerData_(documentElement, docElContext);
  const id = makeFinalNodeId_(documentElement, 'vector');
  const childrenLayers = rootLayer ? rootLayer.children : undefined;
  const alpha = documentElement.getAttribute('opacity') || undefined;

  return new VectorLayer(childrenLayers, id, width, height, alpha);
}

function getUniqueId(prefix = '', objectById = (_) => null, targetObject = null) {
  let n = 0;
  const id_ = () => prefix + (n ? `_${n}` : '');
  while (true) {
    const o = objectById(id_());
    if (!o || o === targetObject) {
      break;
    }
    n++;
  }
  return id_();
}
