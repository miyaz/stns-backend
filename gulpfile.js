'use strict';

let gulp = require('gulp');
let zip = require('gulp-zip');
let del = require('del');
let install = require('gulp-install');
let runSequence = require('run-sequence');
let awsLambda = require('node-aws-lambda');

// distディレクトリのクリーンアップと作成済みのdist.zipの削除
gulp.task('clean', (cb) => {
  return del(['./dist', './dist.zip'], cb);
});

// AWS Lambdaファンクション本体(stnsBackend.js)をdistディレクトリにコピー
gulp.task('js', () => {
  return gulp.src('stnsBackend.js')
         .pipe(gulp.dest('dist/'));
});

// AWS Lambdaファンクションのデプロイメントパッケージ(ZIPファイル)に含めるnode.jsパッケージをdistディレクトリにインストール
// ({production: true} を指定して、開発用のパッケージを除いてインストールを実施)
gulp.task('node-mods', () => {
  return gulp.src(['./package.json', 'package-lock.json'])
         .pipe(gulp.dest('dist/'))
         .pipe(install({production: true}));
});

// デプロイメントパッケージの作成(distディレクトリをZIP化)
gulp.task('zip', () => {
  return gulp.src(['dist/**/*', '!dist/package.json', '!dist/package-lock.json'])
         .pipe(zip('dist.zip'))
         .pipe(gulp.dest('./'));
});

// AWS Lambdaファンクションの登録(ZIPファイルのアップロード)
// (既にFunctionが登録済みの場合はFunctionの内容を更新)
gulp.task('upload', (callback) => {
  awsLambda.deploy('./dist.zip', require('./config/stnsBackend.js'), callback);
});

gulp.task('deploy', (callback) => {
  return runSequence(
      ['clean']
    , ['js', 'node-mods']
    , ['zip']
    , ['upload']
    , callback
  );
});

