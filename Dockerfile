# docker build -t md-beauty https://github.com/engmhmoud/md-beauty.git
# docker run --rm -p 8000:8000 -v "$PWD":/docs md-beauty serve .
FROM squidfunk/mkdocs-material:9.8.0
COPY . /src
RUN pip install --no-cache-dir /src && rm -rf /src
ENV MD_BEAUTY_HOST=0.0.0.0
WORKDIR /docs
EXPOSE 8000
ENTRYPOINT ["md-beauty"]
CMD ["serve", "."]
