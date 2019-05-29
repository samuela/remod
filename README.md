# remod

chmod for human beings!

If UNIX octal permissions get you down, this is the tool for you. Humans were never meant to do bit arithmetic in their heads.

<p align="center">
<a href="https://asciinema.org/a/249047?autoplay=1&loop=1&size=big&speed=1.5"><img src="https://asciinema.org/a/249047.svg" /></a>
</p>

## Installation

```
npm i -g remod-cli
```

## Usage

You can view and interactively edit the permissions of a file with

```
$ remod foo.txt
```

If you think that you want to change a file's permissions to 640 but you'd like to preview the changes first, just run

```
$ remod 640 foo.txt
```
