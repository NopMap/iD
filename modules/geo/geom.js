// @flow
import type { Vec2 } from '.';
type Node = { id: string, loc: Vec2 };
type Edge = { index: number, distance: number, loc: ?Vec2 };

import _every from 'lodash-es/every';
import _some from 'lodash-es/some';

import {
    geoVecAngle,
    geoVecCross,
    geoVecDot,
    geoVecEqual,
    geoVecInterp,
    geoVecLength,
    geoVecSubtract
} from './vector.js';


// Return the counterclockwise angle in the range (-pi, pi)
// between the positive X axis and the line intersecting a and b.
export function geoAngle(a: Node, b: Node, projection: (Vec2) => Vec2): number {
    return geoVecAngle(projection(a.loc), projection(b.loc));
}

export function geoEdgeEqual(a: Vec2, b: Vec2): boolean {
    return (a[0] === b[0] && a[1] === b[1]) ||
        (a[0] === b[1] && a[1] === b[0]);
}

// Rotate all points counterclockwise around a pivot point by given angle
export function geoRotate(points: Array<Vec2>, angle: number, around: Vec2): Array<Vec2> {
    return points.map(function(point: Vec2) {
        var radial = geoVecSubtract(point, around);
        return [
            radial[0] * Math.cos(angle) - radial[1] * Math.sin(angle) + around[0],
            radial[0] * Math.sin(angle) + radial[1] * Math.cos(angle) + around[1]
        ];
    });
}


// Choose the edge with the minimal distance from `point` to its orthogonal
// projection onto that edge, if such a projection exists, or the distance to
// the closest vertex on that edge. Returns an object with the `index` of the
// chosen edge, the chosen `loc` on that edge, and the `distance` to to it.
export function geoChooseEdge(nodes: Array<Node>, point: Vec2, projection: (loc: Vec2) => Vec2, activeID?: string): ?Edge {
    var dist = geoVecLength;
    var points = nodes.map(function(n) { return projection(n.loc); });
    var ids = nodes.map(function(n) { return n.id; });
    var min = Infinity;
    var idx;
    var loc;

    for (var i = 0; i < points.length - 1; i++) {
        if (ids[i] === activeID || ids[i + 1] === activeID) continue;

        var o = points[i];
        var s = geoVecSubtract(points[i + 1], o);
        var v = geoVecSubtract(point, o);
        var proj = geoVecDot(v, s) / geoVecDot(s, s);
        var p;

        if (proj < 0) {
            p = o;
        } else if (proj > 1) {
            p = points[i + 1];
        } else {
            p = [o[0] + proj * s[0], o[1] + proj * s[1]];
        }

        var d = dist(p, point);
        if (d < min) {
            min = d;
            idx = i + 1;
            loc = projection.invert(p);
        }
    }

    if (idx !== undefined) {
        return { index: idx, distance: min, loc: loc };
    } else {
        return null;
    }
}


// Test active (dragged or drawing) segments against inactive segments
// This is used to test e.g. multipolygon rings that cross
// `activeNodes` is the ring containing the activeID being dragged.
// `inactiveNodes` is the other ring to test against
export function geoHasLineIntersections(activeNodes: Array<Node>, inactiveNodes: Array<Node>, activeID?: string): boolean {
    var actives = [];
    var inactives = [];
    var j, k, n1, n2, segment;

    // gather active segments (only segments in activeNodes that contain the activeID)
    for (j = 0; j < activeNodes.length - 1; j++) {
        n1 = activeNodes[j];
        n2 = activeNodes[j+1];
        segment = [n1.loc, n2.loc];
        if (n1.id === activeID || n2.id === activeID) {
            actives.push(segment);
        }
    }

    // gather inactive segments
    for (j = 0; j < inactiveNodes.length - 1; j++) {
        n1 = inactiveNodes[j];
        n2 = inactiveNodes[j+1];
        segment = [n1.loc, n2.loc];
        inactives.push(segment);
    }

    // test
    for (j = 0; j < actives.length; j++) {
        for (k = 0; k < inactives.length; k++) {
            var p = actives[j];
            var q = inactives[k];
            var hit = geoLineIntersection(p, q);
            if (hit) {
                return true;
            }
        }
    }

    return false;
}


// Test active (dragged or drawing) segments against inactive segments
// This is used to test whether a way intersects with itself.
export function geoHasSelfIntersections(nodes: Array<Node>, activeID?: string): boolean {
    var actives = [];
    var inactives = [];
    var j, k;

    // group active and passive segments along the nodes
    for (j = 0; j < nodes.length - 1; j++) {
        var n1 = nodes[j];
        var n2 = nodes[j+1];
        var segment = [n1.loc, n2.loc];
        if (n1.id === activeID || n2.id === activeID) {
            actives.push(segment);
        } else {
            inactives.push(segment);
        }
    }

    // test
    for (j = 0; j < actives.length; j++) {
        for (k = 0; k < inactives.length; k++) {
            var p = actives[j];
            var q = inactives[k];
            // skip if segments share an endpoint
            if (geoVecEqual(p[1], q[0]) || geoVecEqual(p[0], q[1]) ||
                geoVecEqual(p[0], q[0]) || geoVecEqual(p[1], q[1]) ) {
                continue;
            }

            var hit = geoLineIntersection(p, q);
            if (hit) {
                var epsilon = 1e-8;
                // skip if the hit is at the segment's endpoint
                if (geoVecEqual(p[1], hit, epsilon) || geoVecEqual(p[0], hit, epsilon) ||
                    geoVecEqual(q[1], hit, epsilon) || geoVecEqual(q[0], hit, epsilon) ) {
                    continue;
                } else {
                    return true;
                }
            }
        }
    }

    return false;
}


// Return the intersection point of 2 line segments.
// From https://github.com/pgkelley4/line-segments-intersect
// This uses the vector cross product approach described below:
//  http://stackoverflow.com/a/565282/786339
export function geoLineIntersection(a: Array<Vec2>, b: Array<Vec2>): ?Vec2 {
    var p = [a[0][0], a[0][1]];
    var p2 = [a[1][0], a[1][1]];
    var q = [b[0][0], b[0][1]];
    var q2 = [b[1][0], b[1][1]];
    var r = geoVecSubtract(p2, p);
    var s = geoVecSubtract(q2, q);
    var uNumerator = geoVecCross(geoVecSubtract(q, p), r);
    var denominator = geoVecCross(r, s);

    if (uNumerator && denominator) {
        var u = uNumerator / denominator;
        var t = geoVecCross(geoVecSubtract(q, p), s) / denominator;

        if ((t >= 0) && (t <= 1) && (u >= 0) && (u <= 1)) {
            return geoVecInterp(p, p2, t);
        }
    }

    return null;
}


export function geoPathIntersections(path1: Array<Vec2>, path2: Array<Vec2>): Array<Vec2> {
    var intersections = [];
    for (var i = 0; i < path1.length - 1; i++) {
        for (var j = 0; j < path2.length - 1; j++) {
            var a = [ path1[i], path1[i+1] ];
            var b = [ path2[j], path2[j+1] ];
            var hit = geoLineIntersection(a, b);
            if (hit) {
                intersections.push(hit);
            }
        }
    }
    return intersections;
}

export function geoPathHasIntersections(path1: Array<Vec2>, path2: Array<Vec2>): boolean {
    for (var i = 0; i < path1.length - 1; i++) {
        for (var j = 0; j < path2.length - 1; j++) {
            var a = [ path1[i], path1[i+1] ];
            var b = [ path2[j], path2[j+1] ];
            var hit = geoLineIntersection(a, b);
            if (hit) {
                return true;
            }
        }
    }
    return false;
}


// Return whether point is contained in polygon.
//
// `point` should be a 2-item array of coordinates.
// `polygon` should be an array of 2-item arrays of coordinates.
//
// From https://github.com/substack/point-in-polygon.
// ray-casting algorithm based on
// http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
//
export function geoPointInPolygon(point: Vec2, polygon: Array<Vec2>): boolean {
    var x = point[0];
    var y = point[1];
    var inside = false;

    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        var xi = polygon[i][0];
        var yi = polygon[i][1];
        var xj = polygon[j][0];
        var yj = polygon[j][1];

        var intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }

    return inside;
}


export function geoPolygonContainsPolygon(outer: Array<Vec2>, inner: Array<Vec2>): boolean {
    return _every(inner, function(point) {
        return geoPointInPolygon(point, outer);
    });
}


export function geoPolygonIntersectsPolygon(outer: Array<Vec2>, inner: Array<Vec2>, checkSegments: boolean): boolean {
    function testPoints(outer, inner) {
        return _some(inner, function(point) {
            return geoPointInPolygon(point, outer);
        });
    }

   return testPoints(outer, inner) || (!!checkSegments && geoPathHasIntersections(outer, inner));
}


export function geoPathLength(path: Array<Vec2>): number {
    var length = 0;
    for (var i = 0; i < path.length - 1; i++) {
        length += geoVecLength(path[i], path[i + 1]);
    }
    return length;
}


// If the given point is at the edge of the padded viewport,
// return a vector that will nudge the viewport in that direction
export function geoViewportEdge(point: Vec2, dimensions: Vec2): ?Vec2 {
    var pad = [80, 20, 50, 20];   // top, right, bottom, left
    var x = 0;
    var y = 0;

    if (point[0] > dimensions[0] - pad[1])
        x = -10;
    if (point[0] < pad[3])
        x = 10;
    if (point[1] > dimensions[1] - pad[2])
        y = -10;
    if (point[1] < pad[0])
        y = 10;

    if (x || y) {
        return [x, y];
    } else {
        return null;
    }
}
