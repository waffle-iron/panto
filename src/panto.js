/**
 * Copyright (C) 2016 pantojs.xyz
 * sieve.js
 *
 * changelog
 * 2016-06-21[18:46:42]:revised
 *
 * @author yanni4night@gmail.com
 * @version 1.0.0
 * @since 1.0.0
 */
'use strict';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const chokidar = require('chokidar');
const glob = require('glob');
const minimatch = require('minimatch');
const mkdirp = require('mkdirp');
const logger = require('panto-logger');
const isString = require('lodash/isString');
const camelCase = require('lodash/camelCase');
const extend = require('lodash/extend');
const lodash = require('lodash');
const flattenDeep = require('lodash/flattenDeep');

const Stream = require('./stream');
const FileCollection = require('./file-collection');

class Panto extends EventEmitter {
    constructor() {
        super();
        const defaultOpts = {
            cwd: process.cwd(),
            output: 'output',
            binary_resource: 'webp,png,jpg,jpeg,gif,bmp,tiff,swf,woff,woff2,ttf,eot,otf,cur,zip,gz,7z,gzip,tgz,lzh,lha,bz2,bzip2,tbz2,tbz,xz,txz,z,lzma,arj,cab,alz,egg,bh,jar,iso,img,udf,wim,rar,tar,bz2,apk,ipa,exe,pages,numbers,key,graffle,xmind,xls,xlsx,doc,docx,ppt,pptx,pot,potx,ppsx,pps,pptm,potm,ppsm,thmx,ppam,ppa,psd,dmg,pdf,rtf,dot,mht,dotm,docm,csv,xlt,xls,xltx,xla,xltm,xlsm,xlam,xlsb,slk,mobi,mp3,mp4,wma,rmvb,ogg,wav,aiff,midi,au,aac,flac,ape,avi,mov,asf,wmv,3gp,mkv,mov,flv,f4v,rmvb,webm,vob,rmf'
        };
        const options = extend({}, defaultOpts);

        const isBinary = filename => minimatch(filename, options.binary_resource);

        const L = name => path.join(options.cwd, name);

        const safeDirp = name => {
            const fpath = L(name);
            const dir = path.dirname(fpath);
            return new Promise(resolve => {
                fs.exists(dir, exist => {
                    resolve(exist);
                });
            }).then(exist => {
                if (!exist) {
                    return new Promise((resolve, reject) => {
                        mkdirp(dir, err => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(fpath);
                            }
                        });
                    });
                } else {
                    return fpath;
                }
            });
        };

        const R = name => {
            return new Promise((resolve, reject) => {
                fs.readFile(L(name), {
                    encoding: isBinary(name) ? null : 'utf-8'
                }, (err, content) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(content);
                    }
                });
            });
        };

        const W = (name, content) => {
            return safeDirp(path.join(options.output, name)).then(fpath => {
                return new Promise((resolve, reject) => {
                    fs.writeFile(fpath, content, err => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            });
        };

        Object.defineProperties(this, {
            log: {
                value: logger,
                writable: false,
                configurable: false,
                enumerable: true
            },
            util: {
                value: lodash,
                writable: false,
                configurable: false,
                enumerable: true
            },
            streams: {
                value: [],
                writable: false,
                configurable: false,
                enumerable: true
            },
            restStreamIdx: {
                value: -1,
                writable: true,
                configurable: false,
                enumerable: true
            },
            options: {
                value: options,
                writable: false,
                configurable: false,
                enumerable: true
            },
            file: {
                value: {
                    read: R,
                    write: W,
                    locate: L,
                    mkdirp: safeDirp,
                    isBinary
                },
                writable: false,
                configurable: false,
                enumerable: true
            }
        });
        Object.freeze(this.file);
        Object.freeze(this.log);
        Object.freeze(this.util);
    }
    setOptions(opt) {
        extend(this.options, opt);
    }
    getFiles() {
        return new Promise((resolve, reject) => {
            glob('**/*', {
                cwd: this.options.cwd,
                nodir: true,
                ignore: `${this.options.output}/**/*`
            }, (err, filenames) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(filenames);
                }
            });
        });
    }
    pick(pattern) {
        if (!pattern || !isString(pattern)) {
            throw new Error(`A string pattern is required to pick up some files`);
        }
        const stream = new Stream(null, pattern);
        stream.on('end', leaf => {
            this.streams.push(leaf);
        });
        return stream;
    }
    rest() {
        const restStream = new Stream(null, null);
        restStream.on('end', leaf => {
            this.streams.push(leaf);
        });
        return restStream;
    }
    build() {
        return this.getFiles().then(filenames => {
            return this._group(filenames);
        }).then(() => {
            return this._walkStream();
        });
    }
    loadTransformer(name, transformer) {
        if (!transformer) {
            let T = require(`panto-transformer-${name.toLowerCase()}`);
            this[camelCase(name)] = opts => {
                return new T(opts);
            };
        } else {
            this[camelCase(name)] = opts => {
                return new transformer(opts);
            };
        }
    }
    watch() {
        const {
            cwd,
            output
        } = this.options;

        this.log.info('=================================================');
        this.log.info(`Watching ${cwd}...`);

        const watcher = chokidar.watch(`${cwd}/**/*`, {
            ignored: [`${output}/**/*`, /[\/\\]\./],
            persistent: true,
            ignoreInitial: true,
            cwd: cwd
        });
        watcher.on('add', path => {
                this.log.info(`File ${path} has been added`);
                this._onWatchFiles({
                    filename: path,
                    cmd: 'add'
                });
            })
            .on('change', path => {
                this.log.info(`File ${path} has been changed`);
                this._onWatchFiles({
                    filename: path,
                    cmd: 'change'
                });
            })
            .on('unlink', path => {
                this.log.info(`File ${path} has been removed`);
                this._onWatchFiles({
                    filename: path,
                    cmd: 'remove'
                });
            });

    }
    _walkStream() {
        return new Promise((resolve, reject) => {
            let ret = [];
            const startTime = process.hrtime();
            let startStreamIdx = 0;
            const walkStream = () => {
                if (startStreamIdx === this.streams.length) {
                    const diff = process.hrtime(startTime);
                    const totalMs = parseInt(diff[0] * 1e3 + diff[1] / 1e6, 10);

                    this.log.info(`Complete in ${totalMs}ms`);

                    resolve(flattenDeep(ret));
                } else {
                    const stream = this.streams[startStreamIdx];
                    let streamStartTime = process.hrtime();

                    this.log.debug(`${stream.tag}...start[${1+startStreamIdx}/${this.streams.length}]`);

                    stream.flow()
                        .then(
                            data => {
                                let streamDiff = process.hrtime(streamStartTime);
                                const streamMs = parseInt(streamDiff[0] * 1e3 + streamDiff[1] / 1e6, 10);

                                this.log.debug(`${stream.tag}...complete in ${streamMs}ms`);

                                ret.push(data);
                                walkStream();
                            }).catch(reject);
                }
                startStreamIdx += 1;
            };
            walkStream();
        }).then(files => {
            this.emit('complete', files);
            return files;
        });
    }
    _onWatchFiles(...diffs) {

        for (let i = 0; i < diffs.length; ++i) {
            let matched = false;

            for (let j = 0; j < this.streams.length; ++j) {
                if (this.streams[j].fix(diffs[i])) {
                    matched = true;
                }
            }

            if (!matched && this.restStreamIdx >= 0) {
                this.streams[this.restStreamIdx].fix(diffs[i], true);
            }
        }
        return this._walkStream();
    }
    _group(filenames) {

        const leftGroup = new FileCollection();

        for (let i = 0; i < filenames.length; ++i) {
            let filename = filenames[i];
            let matched = false;
            const file = {
                filename
            }; // Mutiple shares

            this.streams.forEach((stream, idx) => {
                if (stream.isRest()) {
                    this.restStreamIdx = idx;
                } else if (stream.swallow(file)) {
                    matched = true;
                }
            });

            if (!matched) {
                leftGroup.add(file);
            }
        }

        if (this.restStreamIdx >= 0) {
            this.streams[this.restStreamIdx].copy(leftGroup);
        }

    }
}

const panto = new Panto();

Object.defineProperty(global, 'panto', {
    value: panto,
    enumerable: true,
    writable: false,
    configurable: false
});

module.exports = panto;